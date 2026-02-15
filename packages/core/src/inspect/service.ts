import { randomUUID } from 'crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { ensureArtifactRootDir } from '../artifacts';
import { driveMutex } from '../drive';
import type { DebuggerBridge } from '../debugger-bridge';
import type {
  DriveAction,
  DriveErrorInfo,
  DriveResponse,
  DriveScreenshotResult,
  DriveTabInfo,
} from '../drive-protocol';
import {
  applyAxSnapshotFilters,
  getAxName,
  getAxNodes,
  getAxRole,
  LABEL_AX_ROLES,
  matchesAxText,
  matchesTextValue,
  normalizeQuery,
  truncateAxSnapshot,
} from './ax-snapshot';
import { toConsoleEntry } from './console';
import { buildHar } from './har';
import { captureHtml } from './html-snapshot';
import { SnapshotHistory } from './snapshot-history';
import {
  applySnapshotRefs,
  assignRefsToAxSnapshot,
  resolveNodeIdForSelector,
} from './snapshot-refs';
import { InspectError } from './errors';
import type {
  ArtifactInfo,
  ConsoleEntry,
  ConsoleListResult,
  DomSnapshotResult,
  EvaluateResult,
  ExtractContentResult,
  FormInfo,
  InspectErrorCode,
  InspectServiceOptions,
  PageStateResult,
  PerformanceMetricsResult,
  StorageEntry,
} from './types';
import { PAGE_STATE_SCRIPT } from '../page-state-script';
import { SessionError, SessionRegistry, SessionRecord } from '../session';
import { SessionState } from '../state';
import { pickBestTarget } from '../target-matching';
import type { TargetHint } from '../target-matching';

const DEFAULT_MAX_SNAPSHOTS_PER_SESSION = 20;
const DEFAULT_MAX_SNAPSHOT_HISTORY = 100;

export class InspectService {
  private readonly registry: SessionRegistry;
  private readonly debugger?: DebuggerBridge;
  private readonly extensionBridge?: {
    isConnected: () => boolean;
    getStatus: () => { tabs: DriveTabInfo[] };
    request?: <T = unknown>(
      action: DriveAction,
      params?: Record<string, unknown>,
      timeoutMs?: number
    ) => Promise<DriveResponse<T>>;
  };
  private lastError?: InspectError;
  private lastErrorAt?: string;
  private readonly snapshots: SnapshotHistory;

  constructor(options: InspectServiceOptions) {
    this.registry = options.registry;
    this.debugger = options.debuggerBridge;
    this.extensionBridge = options.extensionBridge;
    const maxSnapshotsPerSession =
      options.maxSnapshotsPerSession ?? DEFAULT_MAX_SNAPSHOTS_PER_SESSION;
    const maxSnapshotHistory =
      options.maxSnapshotHistory ?? DEFAULT_MAX_SNAPSHOT_HISTORY;
    this.snapshots = new SnapshotHistory({
      maxSnapshotsPerSession,
      maxSnapshotHistory,
    });
  }

  isConnected(): boolean {
    return this.debugger?.hasAttachments() ?? false;
  }

  getLastError(): { error: InspectError; at: string } | undefined {
    if (!this.lastError || !this.lastErrorAt) {
      const debuggerError = this.debugger?.getLastError();
      if (!debuggerError) {
        return undefined;
      }
      return {
        error: new InspectError(
          'INSPECT_UNAVAILABLE',
          debuggerError.error.message,
          {
            retryable: debuggerError.error.retryable,
            details: {
              code: debuggerError.error.code,
              ...(debuggerError.error.details
                ? debuggerError.error.details
                : {}),
            },
          }
        ),
        at: debuggerError.at,
      };
    }
    return { error: this.lastError, at: this.lastErrorAt };
  }

  async reconnect(sessionId: string): Promise<boolean> {
    try {
      this.requireSession(sessionId);
      const selection = await this.resolveTab();
      const debuggerBridge = this.ensureDebugger();
      const result = await debuggerBridge.attach(selection.tabId);
      if (result.ok) {
        this.markInspectConnected(sessionId);
        return true;
      }
      const error = this.mapDebuggerError(result.error);
      this.recordError(error);
      return false;
    } catch (error) {
      if (error instanceof InspectError) {
        this.recordError(error);
      }
      return false;
    }
  }

  async domSnapshot(input: {
    sessionId: string;
    format: 'ax' | 'html';
    consistency: 'best_effort' | 'quiesce';
    interactive?: boolean;
    compact?: boolean;
    maxNodes?: number;
    selector?: string;
    targetHint?: TargetHint;
  }): Promise<DomSnapshotResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);
    const debuggerCommand = this.debuggerCommand.bind(this);

    const work = async (): Promise<DomSnapshotResult> => {
      if (input.format === 'html') {
        const html = await captureHtml(selection.tabId, {
          selector: input.selector,
          debuggerCommand,
          onEvaluationFailed: () => {
            const error = new InspectError(
              'EVALUATION_FAILED',
              'Failed to evaluate HTML snapshot.',
              { retryable: false }
            );
            this.recordError(error);
            throw error;
          },
        });
        const warnings = [...(selection.warnings ?? [])];
        if (input.interactive) {
          warnings.push(
            'Interactive filter is only supported for AX snapshots.'
          );
        }
        if (input.compact) {
          warnings.push('Compact filter is only supported for AX snapshots.');
        }
        if (input.maxNodes !== undefined) {
          warnings.push('max_nodes is only supported for AX snapshots.');
        }
        if (input.selector && html === '') {
          warnings.push(`Selector not found: ${input.selector}`);
        }
        return {
          format: 'html',
          snapshot: html,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      }

      try {
        await this.enableAccessibility(selection.tabId);
        const selectorWarnings: string[] = [];
        let result: unknown;
        if (input.selector) {
          const resolved = await resolveNodeIdForSelector(
            selection.tabId,
            input.selector,
            debuggerCommand
          );
          selectorWarnings.push(...(resolved.warnings ?? []));
          if (!resolved.nodeId) {
            let refWarnings: string[] = [];
            try {
              refWarnings = await applySnapshotRefs(
                selection.tabId,
                new Map(),
                debuggerCommand
              );
            } catch {
              refWarnings = ['Failed to clear prior snapshot refs.'];
            }
            const warnings = [
              ...(selection.warnings ?? []),
              ...selectorWarnings,
              ...refWarnings,
            ];
            return {
              format: 'ax',
              snapshot: { nodes: [] },
              ...(warnings.length > 0 ? { warnings } : {}),
            };
          }
          result = await this.debuggerCommand(
            selection.tabId,
            'Accessibility.getPartialAXTree',
            { nodeId: resolved.nodeId }
          );
        } else {
          result = await this.debuggerCommand(
            selection.tabId,
            'Accessibility.getFullAXTree',
            {}
          );
        }
        let snapshot =
          input.interactive || input.compact
            ? applyAxSnapshotFilters(result, {
                interactiveOnly: input.interactive,
                compact: input.compact,
              })
            : result;
        let truncated = false;
        const truncationWarnings: string[] = [];
        if (input.maxNodes !== undefined) {
          const truncatedResult = truncateAxSnapshot(snapshot, input.maxNodes);
          snapshot = truncatedResult.snapshot;
          truncated = truncatedResult.truncated;
          if (truncated) {
            truncationWarnings.push(
              `AX snapshot truncated to ${input.maxNodes} nodes.`
            );
          }
        }
        const refMap = assignRefsToAxSnapshot(snapshot);
        const refWarnings = await applySnapshotRefs(
          selection.tabId,
          refMap,
          debuggerCommand
        );
        const warnings = [
          ...(selection.warnings ?? []),
          ...selectorWarnings,
          ...truncationWarnings,
          ...(refWarnings ?? []),
        ];
        return {
          format: 'ax',
          snapshot,
          ...(truncated ? { truncated: true } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      } catch (error) {
        if (error instanceof InspectError) {
          const fallbackCodes: InspectErrorCode[] = [
            'NOT_SUPPORTED',
            'INSPECT_UNAVAILABLE',
            'EVALUATION_FAILED',
          ];
          if (!fallbackCodes.includes(error.code)) {
            throw error;
          }
          const html = await captureHtml(selection.tabId, {
            selector: input.selector,
            debuggerCommand,
            onEvaluationFailed: () => {
              const error = new InspectError(
                'EVALUATION_FAILED',
                'Failed to evaluate HTML snapshot.',
                { retryable: false }
              );
              this.recordError(error);
              throw error;
            },
          });
          const warnings = [
            ...(selection.warnings ?? []),
            'AX snapshot failed; returned HTML instead.',
            ...(input.maxNodes !== undefined
              ? ['max_nodes is only supported for AX snapshots.']
              : []),
            ...(input.interactive
              ? ['Interactive filter is only supported for AX snapshots.']
              : []),
            ...(input.compact
              ? ['Compact filter is only supported for AX snapshots.']
              : []),
            ...(input.selector && html === ''
              ? [`Selector not found: ${input.selector}`]
              : []),
          ];
          return {
            format: 'html',
            snapshot: html,
            warnings,
          };
        }
        throw error;
      }
    };

    if (input.consistency === 'quiesce') {
      const result = await driveMutex.runExclusive(work);
      this.snapshots.record(input.sessionId, result);
      this.markInspectConnected(input.sessionId);
      return result;
    }
    const result = await work();
    this.snapshots.record(input.sessionId, result);
    this.markInspectConnected(input.sessionId);
    return result;
  }

  domDiff(input: { sessionId: string }): {
    added: string[];
    removed: string[];
    changed: string[];
    summary: string;
  } {
    this.requireSession(input.sessionId);
    this.markInspectConnected(input.sessionId);
    return this.snapshots.diff(input.sessionId);
  }

  async find(input: {
    sessionId: string;
    kind: 'role' | 'text' | 'label';
    role?: string;
    name?: string;
    text?: string;
    label?: string;
    targetHint?: TargetHint;
  }): Promise<{
    matches: Array<{ ref: string; role?: string; name?: string }>;
    warnings?: string[];
  }> {
    const snapshot = await this.domSnapshot({
      sessionId: input.sessionId,
      format: 'ax',
      consistency: 'best_effort',
      targetHint: input.targetHint,
    });
    const warnings = [...(snapshot.warnings ?? [])];
    if (snapshot.format !== 'ax') {
      warnings.push('AX snapshot unavailable; cannot resolve refs.');
      return {
        matches: [],
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    const nodes = getAxNodes(snapshot.snapshot);
    const matches: Array<{ ref: string; role?: string; name?: string }> = [];

    const nameQuery =
      typeof input.name === 'string' ? normalizeQuery(input.name) : '';
    const textQuery =
      typeof input.text === 'string' ? normalizeQuery(input.text) : '';
    const labelQuery =
      typeof input.label === 'string' ? normalizeQuery(input.label) : '';
    const roleQuery =
      typeof input.role === 'string' ? normalizeQuery(input.role) : '';

    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (typeof node.ref !== 'string' || node.ref.length === 0) {
        continue;
      }
      const role = getAxRole(node);
      const name = getAxName(node);

      if (input.kind === 'role') {
        if (!role || role !== roleQuery) {
          continue;
        }
        if (nameQuery && !matchesTextValue(name, nameQuery)) {
          continue;
        }
      } else if (input.kind === 'text') {
        if (!textQuery || !matchesAxText(node, textQuery)) {
          continue;
        }
      } else if (input.kind === 'label') {
        if (!labelQuery || !LABEL_AX_ROLES.has(role)) {
          continue;
        }
        if (!matchesTextValue(name, labelQuery)) {
          continue;
        }
      }

      matches.push({
        ref: node.ref,
        ...(role ? { role } : {}),
        ...(name ? { name } : {}),
      });
    }

    return {
      matches,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async consoleList(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<ConsoleListResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);
    await this.enableConsole(selection.tabId);

    const events = this.ensureDebugger().getConsoleEvents(selection.tabId);
    const entries = events
      .map((event) => toConsoleEntry(event))
      .filter((entry): entry is ConsoleEntry => entry !== null);

    const result = {
      entries,
      warnings: selection.warnings,
    };
    this.markInspectConnected(input.sessionId);
    return result;
  }

  async networkHar(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<ArtifactInfo> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);
    await this.enableNetwork(selection.tabId);

    const events = this.ensureDebugger().getNetworkEvents(selection.tabId);
    const har = buildHar(events, selection.tab.title);

    try {
      const rootDir = await ensureArtifactRootDir(input.sessionId);
      const artifactId = randomUUID();
      const filePath = path.join(rootDir, `har-${artifactId}.json`);
      await writeFile(filePath, JSON.stringify(har, null, 2), 'utf-8');
      const result = {
        artifact_id: artifactId,
        path: filePath,
        mime: 'application/json',
      };
      this.markInspectConnected(input.sessionId);
      return result;
    } catch {
      const error = new InspectError(
        'ARTIFACT_IO_ERROR',
        'Failed to write HAR file.'
      );
      this.recordError(error);
      throw error;
    }
  }

  async evaluate(input: {
    sessionId: string;
    expression?: string;
    targetHint?: TargetHint;
  }): Promise<EvaluateResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);
    const expression = input.expression ?? 'undefined';

    await this.debuggerCommand(selection.tabId, 'Runtime.enable', {});
    const result = await this.debuggerCommand(
      selection.tabId,
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }
    );

    if (result && typeof result === 'object' && 'exceptionDetails' in result) {
      const output = {
        exception: (result as { exceptionDetails?: unknown }).exceptionDetails,
        warnings: selection.warnings,
      };
      this.markInspectConnected(input.sessionId);
      return output;
    }

    const output = {
      value: (result as { result?: { value?: unknown } })?.result?.value,
      warnings: selection.warnings,
    };
    this.markInspectConnected(input.sessionId);
    return output;
  }

  async extractContent(input: {
    sessionId: string;
    format: 'markdown' | 'text' | 'article_json';
    includeMetadata?: boolean;
    targetHint?: TargetHint;
  }): Promise<ExtractContentResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);

    const debuggerCommand = this.debuggerCommand.bind(this);
    const html = await captureHtml(selection.tabId, {
      debuggerCommand,
      onEvaluationFailed: () => {
        const error = new InspectError(
          'EVALUATION_FAILED',
          'Failed to evaluate HTML snapshot.',
          { retryable: false }
        );
        this.recordError(error);
        throw error;
      },
    });
    const url = selection.tab.url ?? 'about:blank';
    let article: ReturnType<Readability['parse']> | null = null;
    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      article = reader.parse();
    } catch {
      const err = new InspectError(
        'EVALUATION_FAILED',
        'Failed to parse page content.',
        { retryable: false }
      );
      this.recordError(err);
      throw err;
    }

    if (!article) {
      const err = new InspectError(
        'NOT_SUPPORTED',
        'Readability could not extract content.',
        { retryable: false }
      );
      this.recordError(err);
      throw err;
    }

    let content = '';
    if (input.format === 'article_json') {
      content = JSON.stringify(article, null, 2);
    } else if (input.format === 'text') {
      content = article.textContent ?? '';
    } else {
      const turndown = new TurndownService();
      content = turndown.turndown(article.content ?? '');
    }

    const warnings = selection.warnings ?? [];
    const includeMetadata = input.includeMetadata ?? true;
    const output: ExtractContentResult = {
      content,
      ...(includeMetadata
        ? {
            title: article.title ?? undefined,
            byline: article.byline ?? undefined,
            excerpt: article.excerpt ?? undefined,
            siteName: (article as { siteName?: string }).siteName ?? undefined,
          }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    this.markInspectConnected(input.sessionId);
    return output;
  }

  async pageState(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<PageStateResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);

    await this.debuggerCommand(selection.tabId, 'Runtime.enable', {});
    const expression = PAGE_STATE_SCRIPT;

    const result = await this.debuggerCommand(
      selection.tabId,
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }
    );

    if (result && typeof result === 'object' && 'exceptionDetails' in result) {
      const error = new InspectError(
        'EVALUATION_FAILED',
        'Failed to capture page state.',
        { retryable: false }
      );
      this.recordError(error);
      throw error;
    }

    const value = (result as { result?: { value?: unknown } })?.result?.value;
    const raw =
      value && typeof value === 'object'
        ? (value as Partial<PageStateResult>)
        : {};
    const warnings = [
      ...(Array.isArray(raw.warnings) ? raw.warnings : []),
      ...(selection.warnings ?? []),
    ];
    const output: PageStateResult = {
      forms: Array.isArray(raw.forms) ? (raw.forms as FormInfo[]) : [],
      localStorage: Array.isArray(raw.localStorage)
        ? (raw.localStorage as StorageEntry[])
        : [],
      sessionStorage: Array.isArray(raw.sessionStorage)
        ? (raw.sessionStorage as StorageEntry[])
        : [],
      cookies: Array.isArray(raw.cookies)
        ? (raw.cookies as StorageEntry[])
        : [],
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    this.markInspectConnected(input.sessionId);
    return output;
  }

  async performanceMetrics(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<PerformanceMetricsResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);

    await this.debuggerCommand(selection.tabId, 'Performance.enable', {});
    const result = await this.debuggerCommand(
      selection.tabId,
      'Performance.getMetrics',
      {}
    );
    const metrics = Array.isArray((result as { metrics?: unknown[] })?.metrics)
      ? (
          result as { metrics: Array<{ name: string; value: number }> }
        ).metrics.map((metric) => ({
          name: metric.name,
          value: metric.value,
        }))
      : [];

    const output = { metrics, warnings: selection.warnings };
    this.markInspectConnected(input.sessionId);
    return output;
  }

  async screenshot(input: {
    sessionId: string;
    target: 'viewport' | 'full';
    selector?: string;
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
    targetHint?: TargetHint;
  }): Promise<ArtifactInfo> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);

    const format = input.format ?? 'png';
    const writeArtifact = async (data: string): Promise<ArtifactInfo> => {
      try {
        const rootDir = await ensureArtifactRootDir(input.sessionId);
        const artifactId = randomUUID();
        const extension = format === 'jpeg' ? 'jpg' : format;
        const filePath = path.join(
          rootDir,
          `screenshot-${artifactId}.${extension}`
        );
        await writeFile(filePath, Buffer.from(data, 'base64'));
        const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
        const output = {
          artifact_id: artifactId,
          path: filePath,
          mime,
        };
        this.markInspectConnected(input.sessionId);
        return output;
      } catch {
        const error = new InspectError(
          'ARTIFACT_IO_ERROR',
          'Failed to write screenshot file.'
        );
        this.recordError(error);
        throw error;
      }
    };

    if (input.selector) {
      if (!this.extensionBridge?.request) {
        const error = new InspectError(
          'NOT_SUPPORTED',
          'Element screenshots require an extension that supports drive.screenshot.'
        );
        this.recordError(error);
        throw error;
      }

      const response =
        await this.extensionBridge.request<DriveScreenshotResult>(
          'drive.screenshot',
          {
            tab_id: selection.tabId,
            mode: 'element',
            selector: input.selector,
            format,
            ...(typeof input.quality === 'number'
              ? { quality: input.quality }
              : {}),
          },
          120000
        );

      if (response.status === 'error') {
        const error = new InspectError(
          (response.error?.code as InspectErrorCode) ?? 'INSPECT_UNAVAILABLE',
          response.error?.message ?? 'Failed to capture element screenshot.',
          {
            retryable: response.error?.retryable ?? false,
            ...(response.error?.details
              ? { details: response.error.details }
              : {}),
          }
        );
        this.recordError(error);
        throw error;
      }

      const result = response.result;
      if (!result?.data_base64 || typeof result.data_base64 !== 'string') {
        const error = new InspectError(
          'INSPECT_UNAVAILABLE',
          'Failed to capture element screenshot.'
        );
        this.recordError(error);
        throw error;
      }

      return await writeArtifact(result.data_base64);
    }

    if (input.target === 'full' && this.extensionBridge?.request) {
      try {
        const response =
          await this.extensionBridge.request<DriveScreenshotResult>(
            'drive.screenshot',
            {
              tab_id: selection.tabId,
              mode: 'full_page',
              format,
              ...(typeof input.quality === 'number'
                ? { quality: input.quality }
                : {}),
            },
            120000
          );

        if (response.status === 'error') {
          const error = new InspectError(
            (response.error?.code as InspectErrorCode) ?? 'INSPECT_UNAVAILABLE',
            response.error?.message ??
              'Failed to capture full page screenshot.',
            {
              retryable: response.error?.retryable ?? false,
              ...(response.error?.details
                ? { details: response.error.details }
                : {}),
            }
          );
          this.recordError(error);
          throw error;
        }

        const result = response.result;
        if (!result?.data_base64 || typeof result.data_base64 !== 'string') {
          const error = new InspectError(
            'INSPECT_UNAVAILABLE',
            'Failed to capture full page screenshot.'
          );
          this.recordError(error);
          throw error;
        }

        return await writeArtifact(result.data_base64);
      } catch (error) {
        // Fall back to CDP screenshots for environments that don't yet support
        // extension-driven full page capture.
        if (error instanceof InspectError) {
          const code = String(error.code);
          if (
            !error.retryable &&
            ![
              'NOT_SUPPORTED',
              'NOT_IMPLEMENTED',
              'INSPECT_UNAVAILABLE',
              'RATE_LIMITED',
            ].includes(code)
          ) {
            throw error;
          }
        }
      }
    }

    await this.debuggerCommand(selection.tabId, 'Page.enable', {});

    let captureParams: Record<string, unknown> = {
      format,
      fromSurface: true,
    };
    if (format !== 'png' && typeof input.quality === 'number') {
      captureParams = { ...captureParams, quality: input.quality };
    }

    if (input.target === 'full') {
      const layout = await this.debuggerCommand(
        selection.tabId,
        'Page.getLayoutMetrics',
        {}
      );
      const contentSize = (
        layout as { contentSize?: { width: number; height: number } }
      )?.contentSize;
      if (contentSize) {
        captureParams = {
          ...captureParams,
          clip: {
            x: 0,
            y: 0,
            width: contentSize.width,
            height: contentSize.height,
            scale: 1,
          },
        };
      } else {
        captureParams = { ...captureParams, captureBeyondViewport: true };
      }
    }

    const result = await this.debuggerCommand(
      selection.tabId,
      'Page.captureScreenshot',
      captureParams
    );
    const data = (result as { data?: string }).data;
    if (!data) {
      const error = new InspectError(
        'INSPECT_UNAVAILABLE',
        'Failed to capture screenshot.',
        { retryable: false }
      );
      this.recordError(error);
      throw error;
    }

    return await writeArtifact(data);
  }

  private ensureDebugger(): DebuggerBridge {
    if (!this.debugger) {
      const error = this.buildUnavailableError();
      this.recordError(error);
      throw error;
    }
    return this.debugger;
  }

  private async resolveTab(
    hint?: TargetHint
  ): Promise<{ tabId: number; tab: DriveTabInfo; warnings?: string[] }> {
    if (!this.extensionBridge || !this.extensionBridge.isConnected()) {
      const error = new InspectError(
        'EXTENSION_DISCONNECTED',
        'Extension is not connected.',
        { retryable: true }
      );
      this.recordError(error);
      throw error;
    }

    const tabs = this.extensionBridge.getStatus().tabs ?? [];
    if (!Array.isArray(tabs) || tabs.length === 0) {
      const error = new InspectError(
        'TAB_NOT_FOUND',
        'No tabs available to inspect.'
      );
      this.recordError(error);
      throw error;
    }

    const candidates = tabs.map((tab) => ({
      id: String(tab.tab_id),
      url: tab.url ?? '',
      title: tab.title,
      lastSeenAt: tab.last_active_at
        ? Date.parse(tab.last_active_at)
        : undefined,
    }));

    const ranked = pickBestTarget(candidates, hint);
    if (!ranked) {
      const error = new InspectError('TAB_NOT_FOUND', 'No matching tab found.');
      this.recordError(error);
      throw error;
    }

    const tabId = Number(ranked.candidate.id);
    if (!Number.isFinite(tabId)) {
      const error = new InspectError(
        'TAB_NOT_FOUND',
        'Resolved tab id is invalid.'
      );
      this.recordError(error);
      throw error;
    }

    const tab = tabs.find((entry) => entry.tab_id === tabId) ?? tabs[0];
    const warnings: string[] = [];
    if (!hint) {
      warnings.push('No target hint provided; using the most recent tab.');
    } else if (ranked.score < 20) {
      warnings.push('Weak target match; using best available tab.');
    }

    return {
      tabId,
      tab,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private async enableConsole(tabId: number): Promise<void> {
    await this.debuggerCommand(tabId, 'Runtime.enable', {});
    await this.debuggerCommand(tabId, 'Log.enable', {});
  }

  private async enableNetwork(tabId: number): Promise<void> {
    await this.debuggerCommand(tabId, 'Network.enable', {});
  }

  private async enableAccessibility(tabId: number): Promise<void> {
    await this.debuggerCommand(tabId, 'Accessibility.enable', {});
  }

  private async debuggerCommand(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown> {
    const debuggerBridge = this.ensureDebugger();
    const result = await debuggerBridge.command(
      tabId,
      method,
      params,
      timeoutMs
    );
    if (!result.ok) {
      const error = this.mapDebuggerError(result.error);
      this.recordError(error);
      throw error;
    }
    return result.result;
  }

  private mapDebuggerError(error: DriveErrorInfo): InspectError {
    const allowed: InspectErrorCode[] = [
      'INSPECT_UNAVAILABLE',
      'EXTENSION_DISCONNECTED',
      'DEBUGGER_IN_USE',
      'ATTACH_DENIED',
      'TAB_NOT_FOUND',
      'NOT_SUPPORTED',
      'RATE_LIMITED',
      'TIMEOUT',
      'EVALUATION_FAILED',
      'ARTIFACT_IO_ERROR',
      'INVALID_ARGUMENT',
      'INTERNAL',
    ];

    const code = allowed.includes(error.code as InspectErrorCode)
      ? (error.code as InspectErrorCode)
      : 'INSPECT_UNAVAILABLE';
    return new InspectError(code, error.message, {
      retryable: error.retryable,
      details: error.details,
    });
  }

  private markInspectConnected(sessionId: string): void {
    this.clearLastError();
    try {
      const session = this.registry.require(sessionId);
      if (
        session.state === SessionState.INIT ||
        session.state === SessionState.DRIVE_READY
      ) {
        this.registry.apply(sessionId, 'INSPECT_CONNECTED');
      } else if (session.state === SessionState.DEGRADED_INSPECT) {
        this.registry.apply(sessionId, 'RECOVER_SUCCEEDED');
      }
    } catch {
      // Ignore invalid transitions.
    }
  }

  private recordError(error: InspectError): void {
    this.lastError = error;
    this.lastErrorAt = new Date().toISOString();
  }

  private clearLastError(): void {
    this.lastError = undefined;
    this.lastErrorAt = undefined;
  }

  private buildUnavailableError(): InspectError {
    return new InspectError(
      'INSPECT_UNAVAILABLE',
      'Inspect is not available until the debugger bridge is configured.',
      { retryable: false }
    );
  }

  private requireSession(sessionId: string): SessionRecord {
    try {
      return this.registry.require(sessionId);
    } catch (error) {
      if (error instanceof SessionError) {
        const code =
          error.code === 'SESSION_CLOSED'
            ? 'SESSION_CLOSED'
            : 'SESSION_NOT_FOUND';
        const wrapped = new InspectError(code, error.message);
        this.recordError(wrapped);
        throw wrapped;
      }
      const wrapped = new InspectError('INTERNAL', 'Failed to load session.');
      this.recordError(wrapped);
      throw wrapped;
    }
  }
}

export const createInspectService = (
  options: InspectServiceOptions
): InspectService => new InspectService(options);
