import { randomUUID } from 'crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { ensureArtifactRootDir } from './artifacts';
import { driveMutex } from './drive';
import type { DebuggerBridge, DebuggerEventRecord } from './debugger-bridge';
import type { DriveErrorInfo, DriveTabInfo } from './drive-protocol';
import { PAGE_STATE_SCRIPT } from './page-state-script';
import { SessionError, SessionRegistry, SessionRecord } from './session';
import { SessionState } from './state';
import { pickBestTarget } from './target-matching';
import type { TargetHint } from './target-matching';

export type InspectErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'INSPECT_UNAVAILABLE'
  | 'EXTENSION_DISCONNECTED'
  | 'DEBUGGER_IN_USE'
  | 'ATTACH_DENIED'
  | 'TAB_NOT_FOUND'
  | 'NOT_SUPPORTED'
  | 'TIMEOUT'
  | 'EVALUATION_FAILED'
  | 'ARTIFACT_IO_ERROR'
  | 'INTERNAL';

export class InspectError extends Error {
  public readonly code: InspectErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: InspectErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = 'InspectError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export type DomSnapshotResult = {
  format: 'ax' | 'html';
  snapshot: unknown;
  warnings?: string[];
  truncated?: boolean;
};

type AxNodeRecord = {
  nodeId?: string;
  backendDOMNodeId?: number;
  role?: { value?: string } | string;
  name?: { value?: string } | string;
  childIds?: string[];
  ignored?: boolean;
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
  ref?: string;
};

type SnapshotRecord = {
  sessionId: string;
  format: 'ax' | 'html';
  entries: Map<string, string>;
  capturedAt: string;
};

export type ConsoleEntry = {
  level?: string;
  text?: string;
  timestamp?: string;
  source?: { url?: string; line?: number; column?: number };
  stack?: Array<{
    functionName?: string;
    url?: string;
    line?: number;
    column?: number;
  }>;
  exception?: {
    type?: string;
    subtype?: string;
    description?: string;
    value?: unknown;
    unserializableValue?: string;
  };
  args?: Array<{
    type?: string;
    subtype?: string;
    description?: string;
    value?: unknown;
    unserializableValue?: string;
  }>;
};

export type ConsoleListResult = {
  entries: ConsoleEntry[];
  warnings?: string[];
};

export type EvaluateResult = {
  value?: unknown;
  exception?: unknown;
  warnings?: string[];
};

export type ExtractContentResult = {
  content: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  warnings?: string[];
};

export type FormFieldInfo = {
  name: string;
  type: string;
  value: string;
  options?: string[];
};

export type FormInfo = {
  selector: string;
  action?: string;
  method?: string;
  fields: FormFieldInfo[];
};

export type StorageEntry = {
  key: string;
  value: string;
};

export type PageStateResult = {
  forms: FormInfo[];
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  cookies: StorageEntry[];
  warnings?: string[];
};

export type PerformanceMetricsResult = {
  metrics: Array<{ name: string; value: number }>;
  warnings?: string[];
};

export type ArtifactInfo = {
  artifact_id: string;
  path: string;
  mime: string;
};

export type InspectServiceOptions = {
  registry: SessionRegistry;
  debuggerBridge?: DebuggerBridge;
  extensionBridge?: {
    isConnected: () => boolean;
    getStatus: () => { tabs: DriveTabInfo[] };
  };
  maxSnapshotsPerSession?: number;
  maxSnapshotHistory?: number;
};

const DEFAULT_MAX_SNAPSHOTS_PER_SESSION = 20;
const DEFAULT_MAX_SNAPSHOT_HISTORY = 100;
const SNAPSHOT_REF_ATTRIBUTE = 'data-bv-ref';
const MAX_REF_ASSIGNMENTS = 500;
const MAX_REF_WARNINGS = 5;
const INTERACTIVE_AX_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'switch',
  'searchbox',
  'spinbutton',
  'slider',
  'option',
]);
const DECORATIVE_AX_ROLES = new Set(['generic', 'none', 'presentation']);
const LABEL_AX_ROLES = new Set([
  'textbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'switch',
  'searchbox',
  'spinbutton',
  'slider',
]);

export class InspectService {
  private readonly registry: SessionRegistry;
  private readonly debugger?: DebuggerBridge;
  private readonly extensionBridge?: {
    isConnected: () => boolean;
    getStatus: () => { tabs: DriveTabInfo[] };
  };
  private lastError?: InspectError;
  private lastErrorAt?: string;
  private readonly snapshotHistory: SnapshotRecord[] = [];
  private readonly maxSnapshotsPerSession: number;
  private readonly maxSnapshotHistory: number;

  constructor(options: InspectServiceOptions) {
    this.registry = options.registry;
    this.debugger = options.debuggerBridge;
    this.extensionBridge = options.extensionBridge;
    this.maxSnapshotsPerSession =
      options.maxSnapshotsPerSession ?? DEFAULT_MAX_SNAPSHOTS_PER_SESSION;
    this.maxSnapshotHistory =
      options.maxSnapshotHistory ?? DEFAULT_MAX_SNAPSHOT_HISTORY;
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

    const work = async (): Promise<DomSnapshotResult> => {
      if (input.format === 'html') {
        const html = await this.captureHtml(selection.tabId, input.selector);
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
          const resolved = await this.resolveNodeIdForSelector(
            selection.tabId,
            input.selector
          );
          selectorWarnings.push(...(resolved.warnings ?? []));
          if (!resolved.nodeId) {
            let refWarnings: string[] = [];
            try {
              refWarnings = await this.applySnapshotRefs(
                selection.tabId,
                new Map()
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
            ? this.applyAxSnapshotFilters(result, {
                interactiveOnly: input.interactive,
                compact: input.compact,
              })
            : result;
        let truncated = false;
        const truncationWarnings: string[] = [];
        if (input.maxNodes !== undefined) {
          const truncatedResult = this.truncateAxSnapshot(
            snapshot,
            input.maxNodes
          );
          snapshot = truncatedResult.snapshot;
          truncated = truncatedResult.truncated;
          if (truncated) {
            truncationWarnings.push(
              `AX snapshot truncated to ${input.maxNodes} nodes.`
            );
          }
        }
        const refMap = this.assignRefsToAxSnapshot(snapshot);
        const refWarnings = await this.applySnapshotRefs(
          selection.tabId,
          refMap
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
          const html = await this.captureHtml(selection.tabId, input.selector);
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
      this.recordSnapshot(input.sessionId, result);
      this.markInspectConnected(input.sessionId);
      return result;
    }
    const result = await work();
    this.recordSnapshot(input.sessionId, result);
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
    const snapshots = this.snapshotHistory.filter(
      (record) => record.sessionId === input.sessionId
    );
    if (snapshots.length < 2) {
      return {
        added: [],
        removed: [],
        changed: [],
        summary: 'Not enough snapshots to diff.',
      };
    }
    const previous = snapshots[snapshots.length - 2];
    const current = snapshots[snapshots.length - 1];

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const [key, value] of current.entries.entries()) {
      if (!previous.entries.has(key)) {
        added.push(key);
      } else if (previous.entries.get(key) !== value) {
        changed.push(key);
      }
    }
    for (const key of previous.entries.keys()) {
      if (!current.entries.has(key)) {
        removed.push(key);
      }
    }

    return {
      added,
      removed,
      changed,
      summary: `Added ${added.length}, removed ${removed.length}, changed ${changed.length}.`,
    };
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

    const nodes = this.getAxNodes(snapshot.snapshot);
    const matches: Array<{ ref: string; role?: string; name?: string }> = [];

    const nameQuery =
      typeof input.name === 'string' ? this.normalizeQuery(input.name) : '';
    const textQuery =
      typeof input.text === 'string' ? this.normalizeQuery(input.text) : '';
    const labelQuery =
      typeof input.label === 'string' ? this.normalizeQuery(input.label) : '';
    const roleQuery =
      typeof input.role === 'string' ? this.normalizeQuery(input.role) : '';

    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (typeof node.ref !== 'string' || node.ref.length === 0) {
        continue;
      }
      const role = this.getAxRole(node);
      const name = this.getAxName(node);

      if (input.kind === 'role') {
        if (!role || role !== roleQuery) {
          continue;
        }
        if (nameQuery && !this.matchesTextValue(name, nameQuery)) {
          continue;
        }
      } else if (input.kind === 'text') {
        if (!textQuery || !this.matchesAxText(node, textQuery)) {
          continue;
        }
      } else if (input.kind === 'label') {
        if (!labelQuery || !LABEL_AX_ROLES.has(role)) {
          continue;
        }
        if (!this.matchesTextValue(name, labelQuery)) {
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
      .map((event) => this.toConsoleEntry(event))
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
    const har = this.buildHar(events, selection.tab.title);

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

    const html = await this.captureHtml(selection.tabId);
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
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
    targetHint?: TargetHint;
  }): Promise<ArtifactInfo> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.targetHint);

    await this.debuggerCommand(selection.tabId, 'Page.enable', {});

    const format = input.format ?? 'png';
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

  private recordSnapshot(sessionId: string, snapshot: DomSnapshotResult): void {
    const entries = this.collectSnapshotEntries(snapshot);
    if (!entries) {
      return;
    }
    this.snapshotHistory.push({
      sessionId,
      format: snapshot.format,
      entries,
      capturedAt: new Date().toISOString(),
    });
    let count = 0;
    for (const record of this.snapshotHistory) {
      if (record.sessionId === sessionId) {
        count += 1;
      }
    }
    while (count > this.maxSnapshotsPerSession) {
      const index = this.snapshotHistory.findIndex(
        (record) => record.sessionId === sessionId
      );
      if (index === -1) {
        break;
      }
      this.snapshotHistory.splice(index, 1);
      count -= 1;
    }
    while (this.snapshotHistory.length > this.maxSnapshotHistory) {
      this.snapshotHistory.shift();
    }
  }

  private collectSnapshotEntries(
    snapshot: DomSnapshotResult
  ): Map<string, string> | null {
    if (snapshot.format === 'html' && typeof snapshot.snapshot === 'string') {
      return this.collectHtmlEntries(snapshot.snapshot);
    }
    if (snapshot.format === 'ax') {
      return this.collectAxEntries(snapshot.snapshot);
    }
    return null;
  }

  private getAxNodes(snapshot: unknown): AxNodeRecord[] {
    const nodes = Array.isArray(snapshot)
      ? snapshot
      : (snapshot as { nodes?: unknown[] })?.nodes;
    return Array.isArray(nodes) ? (nodes as AxNodeRecord[]) : [];
  }

  private applyAxSnapshotFilters(
    snapshot: unknown,
    options: { interactiveOnly?: boolean; compact?: boolean }
  ): unknown {
    let filtered = snapshot;
    if (options.compact) {
      filtered = this.compactAxSnapshot(filtered);
    }
    if (options.interactiveOnly) {
      filtered = this.filterAxSnapshot(filtered, (node) =>
        this.isInteractiveAxNode(node)
      );
    }
    return filtered;
  }

  private truncateAxSnapshot(
    snapshot: unknown,
    maxNodes: number
  ): { snapshot: unknown; truncated: boolean } {
    const nodes = this.getAxNodes(snapshot);
    if (!Number.isFinite(maxNodes) || maxNodes <= 0) {
      return { snapshot, truncated: false };
    }
    if (nodes.length === 0 || nodes.length <= maxNodes) {
      return { snapshot, truncated: false };
    }

    const nodeById = new Map<string, AxNodeRecord>();
    const parentCount = new Map<string, number>();
    for (const node of nodes) {
      if (
        !node ||
        typeof node !== 'object' ||
        typeof node.nodeId !== 'string'
      ) {
        continue;
      }
      nodeById.set(node.nodeId, node);
      parentCount.set(node.nodeId, parentCount.get(node.nodeId) ?? 0);
    }

    // If the snapshot doesn't have stable node ids, fall back to a hard slice.
    if (nodeById.size === 0) {
      const sliced = nodes.slice(0, maxNodes);
      for (const node of sliced) {
        if (node && typeof node === 'object' && Array.isArray(node.childIds)) {
          node.childIds = [];
        }
      }
      return {
        snapshot: this.replaceAxNodes(snapshot, sliced),
        truncated: true,
      };
    }

    for (const node of nodes) {
      if (!node || typeof node !== 'object' || !Array.isArray(node.childIds)) {
        continue;
      }
      for (const childId of node.childIds) {
        if (typeof childId !== 'string') {
          continue;
        }
        parentCount.set(childId, (parentCount.get(childId) ?? 0) + 1);
      }
    }

    let roots = Array.from(nodeById.keys()).filter(
      (id) => (parentCount.get(id) ?? 0) === 0
    );
    if (roots.length === 0) {
      const first = nodes.find(
        (node) => node && typeof node.nodeId === 'string'
      )?.nodeId;
      if (first) {
        roots = [first];
      }
    }

    const kept = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [...roots];
    while (queue.length > 0 && kept.size < maxNodes) {
      const id = queue.shift();
      if (!id || visited.has(id)) {
        continue;
      }
      visited.add(id);
      const node = nodeById.get(id);
      if (!node) {
        continue;
      }
      kept.add(id);
      if (Array.isArray(node.childIds)) {
        for (const childId of node.childIds) {
          if (typeof childId === 'string' && !visited.has(childId)) {
            queue.push(childId);
          }
        }
      }
    }

    // As a last resort, keep the first n nodes that have ids.
    if (kept.size === 0) {
      const fallback: string[] = [];
      for (const node of nodes) {
        if (fallback.length >= maxNodes) {
          break;
        }
        if (node && typeof node.nodeId === 'string') {
          fallback.push(node.nodeId);
        }
      }
      fallback.forEach((id) => kept.add(id));
    }

    const filtered = nodes.filter(
      (node) => node && typeof node.nodeId === 'string' && kept.has(node.nodeId)
    );
    for (const node of filtered) {
      if (Array.isArray(node.childIds)) {
        node.childIds = node.childIds.filter(
          (id) => typeof id === 'string' && kept.has(id)
        );
      }
    }

    return {
      snapshot: this.replaceAxNodes(snapshot, filtered),
      truncated: true,
    };
  }

  private filterAxSnapshot(
    snapshot: unknown,
    predicate: (node: AxNodeRecord) => boolean
  ): unknown {
    const nodes = this.getAxNodes(snapshot);
    if (nodes.length === 0) {
      return snapshot;
    }
    const keepIds = new Set<string>();
    const filtered = nodes.filter((node) => {
      if (!node || typeof node !== 'object') {
        return false;
      }
      const keep = predicate(node);
      if (keep && typeof node.nodeId === 'string') {
        keepIds.add(node.nodeId);
      }
      return keep;
    });
    for (const node of filtered) {
      if (Array.isArray(node.childIds)) {
        node.childIds = node.childIds.filter((id) => keepIds.has(id));
      }
    }
    return this.replaceAxNodes(snapshot, filtered);
  }

  private replaceAxNodes(snapshot: unknown, nodes: AxNodeRecord[]): unknown {
    if (Array.isArray(snapshot)) {
      return nodes;
    }
    if (snapshot && typeof snapshot === 'object') {
      (snapshot as { nodes?: unknown[] }).nodes = nodes;
    }
    return snapshot;
  }

  private isInteractiveAxNode(node: AxNodeRecord): boolean {
    const role = this.getAxRole(node);
    return Boolean(role && INTERACTIVE_AX_ROLES.has(role));
  }

  private compactAxSnapshot(snapshot: unknown): unknown {
    const nodes = this.getAxNodes(snapshot);
    if (nodes.length === 0) {
      return snapshot;
    }
    const nodeById = new Map<string, AxNodeRecord>();
    nodes.forEach((node) => {
      if (node && typeof node.nodeId === 'string') {
        nodeById.set(node.nodeId, node);
      }
    });

    const keepIds = new Set<string>();
    for (const node of nodes) {
      if (
        !node ||
        typeof node !== 'object' ||
        typeof node.nodeId !== 'string'
      ) {
        continue;
      }
      if (this.shouldKeepCompactNode(node)) {
        keepIds.add(node.nodeId);
      }
    }

    const filtered = nodes.filter(
      (node) =>
        node && typeof node.nodeId === 'string' && keepIds.has(node.nodeId)
    );

    for (const node of filtered) {
      if (!Array.isArray(node.childIds) || typeof node.nodeId !== 'string') {
        continue;
      }
      const nextChildIds: string[] = [];
      for (const childId of node.childIds) {
        nextChildIds.push(
          ...this.collectKeptDescendants(childId, nodeById, keepIds)
        );
      }
      node.childIds = Array.from(new Set(nextChildIds));
    }

    return this.replaceAxNodes(snapshot, filtered);
  }

  private collectKeptDescendants(
    nodeId: string,
    nodeById: Map<string, AxNodeRecord>,
    keepIds: Set<string>,
    visited: Set<string> = new Set()
  ): string[] {
    if (visited.has(nodeId)) {
      return [];
    }
    visited.add(nodeId);
    if (keepIds.has(nodeId)) {
      return [nodeId];
    }
    const node = nodeById.get(nodeId);
    if (!node || !Array.isArray(node.childIds)) {
      return [];
    }
    const output: string[] = [];
    for (const childId of node.childIds) {
      output.push(
        ...this.collectKeptDescendants(childId, nodeById, keepIds, visited)
      );
    }
    return output;
  }

  private shouldKeepCompactNode(node: AxNodeRecord): boolean {
    if (node.ignored) {
      return false;
    }
    const role = this.getAxRole(node);
    if (role && INTERACTIVE_AX_ROLES.has(role)) {
      return true;
    }
    const name = this.getAxName(node);
    const hasName = name.trim().length > 0;
    const hasValue = this.hasAxValue(node);
    if (hasName || hasValue) {
      return true;
    }
    const hasChildren =
      Array.isArray(node.childIds) && node.childIds.length > 0;
    if (!role || DECORATIVE_AX_ROLES.has(role)) {
      return false;
    }
    return hasChildren;
  }

  private getAxRole(node: AxNodeRecord): string {
    const role =
      typeof node.role === 'string' ? node.role : (node.role?.value ?? '');
    return typeof role === 'string' ? role.toLowerCase() : '';
  }

  private getAxName(node: AxNodeRecord): string {
    const name =
      typeof node.name === 'string' ? node.name : (node.name?.value ?? '');
    return typeof name === 'string' ? name : '';
  }

  private hasAxValue(node: AxNodeRecord): boolean {
    if (!Array.isArray(node.properties)) {
      return false;
    }
    for (const prop of node.properties) {
      if (!prop || typeof prop !== 'object') {
        continue;
      }
      const value = (prop as { value?: { value?: unknown } }).value?.value;
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === 'string' && value.trim().length === 0) {
        continue;
      }
      return true;
    }
    return false;
  }

  private normalizeQuery(value: string): string {
    return value.trim().toLowerCase();
  }

  private matchesTextValue(value: string, query: string): boolean {
    if (!query) {
      return false;
    }
    return value.toLowerCase().includes(query);
  }

  private matchesAxText(node: AxNodeRecord, query: string): boolean {
    if (!query) {
      return false;
    }
    const candidates = [this.getAxName(node)];
    if (Array.isArray(node.properties)) {
      for (const prop of node.properties) {
        if (!prop || typeof prop !== 'object') {
          continue;
        }
        const value = (prop as { value?: { value?: unknown } }).value?.value;
        if (value === undefined || value === null) {
          continue;
        }
        if (typeof value === 'string') {
          candidates.push(value);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          candidates.push(String(value));
        }
      }
    }
    return candidates.some((text) => this.matchesTextValue(text, query));
  }

  private collectHtmlEntries(html: string): Map<string, string> {
    const entries = new Map<string, string>();
    const tagPattern = /<([a-zA-Z0-9-]+)([^>]*)>/g;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = tagPattern.exec(html)) && entries.size < 1000) {
      const tag = match[1].toLowerCase();
      const attrs = match[2] ?? '';
      const idMatch = /\bid=["']([^"']+)["']/.exec(attrs);
      const classMatch = /\bclass=["']([^"']+)["']/.exec(attrs);
      const id = idMatch?.[1];
      const className = classMatch?.[1]?.split(/\s+/)[0];
      let key = tag;
      if (id) {
        key = `${tag}#${id}`;
      } else if (className) {
        key = `${tag}.${className}`;
      } else {
        key = `${tag}:nth-${index}`;
      }
      entries.set(key, attrs.trim());
      index += 1;
    }
    return entries;
  }

  private collectAxEntries(snapshot: unknown): Map<string, string> {
    const entries = new Map<string, string>();
    const nodes = this.getAxNodes(snapshot);
    if (nodes.length === 0) {
      return entries;
    }
    nodes.forEach((node, index) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      const record = node as {
        nodeId?: string;
        backendDOMNodeId?: number;
        role?: { value?: string } | string;
        name?: { value?: string } | string;
      };
      const role =
        typeof record.role === 'string'
          ? record.role
          : (record.role?.value ?? 'node');
      const name =
        typeof record.name === 'string'
          ? record.name
          : (record.name?.value ?? '');
      const nodeId =
        record.nodeId ??
        (record.backendDOMNodeId !== undefined
          ? String(record.backendDOMNodeId)
          : undefined);
      const key = nodeId ? `node-${nodeId}` : `${role}:${name}:${index}`;
      entries.set(key, `${role}:${name}`);
    });
    return entries;
  }

  private assignRefsToAxSnapshot(snapshot: unknown): Map<number, string> {
    const nodes = this.getAxNodes(snapshot);
    const refs = new Map<number, string>();
    let index = 1;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (node.ignored) {
        continue;
      }
      const backendId = node.backendDOMNodeId;
      if (typeof backendId !== 'number') {
        continue;
      }
      const ref = `@e${index}`;
      index += 1;
      node.ref = ref;
      refs.set(backendId, ref);
    }
    return refs;
  }

  private async applySnapshotRefs(
    tabId: number,
    refs: Map<number, string>
  ): Promise<string[]> {
    const warnings: string[] = [];
    await this.debuggerCommand(tabId, 'DOM.enable', {});
    await this.debuggerCommand(tabId, 'Runtime.enable', {});

    try {
      await this.clearSnapshotRefs(tabId);
    } catch {
      warnings.push('Failed to clear prior snapshot refs.');
    }

    if (refs.size === 0) {
      return warnings;
    }

    let applied = 0;
    for (const [backendNodeId, ref] of refs) {
      if (applied >= MAX_REF_ASSIGNMENTS) {
        warnings.push(
          `Snapshot refs truncated at ${MAX_REF_ASSIGNMENTS} elements.`
        );
        break;
      }
      try {
        const described = await this.debuggerCommand(
          tabId,
          'DOM.describeNode',
          {
            backendNodeId,
          }
        );
        const node = (
          described as { node?: { nodeId?: number; nodeType?: number } }
        ).node;
        if (!node || node.nodeType !== 1 || typeof node.nodeId !== 'number') {
          if (warnings.length < MAX_REF_WARNINGS) {
            warnings.push(`Ref ${ref} could not be applied to a DOM element.`);
          }
          continue;
        }
        await this.debuggerCommand(tabId, 'DOM.setAttributeValue', {
          nodeId: node.nodeId,
          name: SNAPSHOT_REF_ATTRIBUTE,
          value: ref,
        });
        applied += 1;
      } catch {
        if (warnings.length < MAX_REF_WARNINGS) {
          warnings.push(`Ref ${ref} could not be applied.`);
        }
      }
    }
    return warnings;
  }

  private async clearSnapshotRefs(tabId: number): Promise<void> {
    await this.debuggerCommand(tabId, 'Runtime.evaluate', {
      expression: `document.querySelectorAll('[${SNAPSHOT_REF_ATTRIBUTE}]').forEach((el) => el.removeAttribute('${SNAPSHOT_REF_ATTRIBUTE}'))`,
      returnByValue: true,
      awaitPromise: true,
    });
  }

  private async resolveNodeIdForSelector(
    tabId: number,
    selector: string
  ): Promise<{ nodeId?: number; warnings?: string[] }> {
    await this.debuggerCommand(tabId, 'DOM.enable', {});
    const document = await this.debuggerCommand(tabId, 'DOM.getDocument', {
      depth: 1,
    });
    const rootNodeId = (document as { root?: { nodeId?: number } }).root
      ?.nodeId;
    if (typeof rootNodeId !== 'number') {
      return { warnings: ['Failed to resolve DOM root for selector.'] };
    }
    try {
      const result = await this.debuggerCommand(tabId, 'DOM.querySelector', {
        nodeId: rootNodeId,
        selector,
      });
      const nodeId = (result as { nodeId?: number }).nodeId;
      if (!nodeId) {
        return { warnings: [`Selector not found: ${selector}`] };
      }
      return { nodeId };
    } catch (error) {
      if (error instanceof InspectError) {
        return { warnings: [error.message] };
      }
      return { warnings: ['Selector query failed.'] };
    }
  }

  private async captureHtml(tabId: number, selector?: string): Promise<string> {
    await this.debuggerCommand(tabId, 'Runtime.enable', {});
    const expression = selector
      ? `(() => { try { const el = document.querySelector(${JSON.stringify(
          selector
        )}); return el ? el.outerHTML : ""; } catch { return ""; } })()`
      : "document.documentElement ? document.documentElement.outerHTML : ''";
    const result = await this.debuggerCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result && typeof result === 'object' && 'exceptionDetails' in result) {
      const error = new InspectError(
        'EVALUATION_FAILED',
        'Failed to evaluate HTML snapshot.',
        { retryable: false }
      );
      this.recordError(error);
      throw error;
    }

    return String(
      (result as { result?: { value?: unknown } })?.result?.value ?? ''
    );
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

  private toConsoleEntry(event: DebuggerEventRecord): ConsoleEntry | null {
    const params = event.params ?? {};
    switch (event.method) {
      case 'Runtime.consoleAPICalled': {
        const rawArgs = Array.isArray((params as { args?: unknown[] }).args)
          ? (params as { args: unknown[] }).args
          : [];
        const text = rawArgs
          .map((arg) => this.stringifyRemoteObject(arg))
          .join(' ');
        const level = String((params as { type?: string }).type ?? 'log');
        const stack = this.toStackFrames(
          (params as { stackTrace?: unknown }).stackTrace
        );
        const args = rawArgs
          .map((arg) => this.toRemoteObjectSummary(arg))
          .filter((entry): entry is NonNullable<typeof entry> =>
            Boolean(entry)
          );
        return {
          level,
          text,
          timestamp: event.timestamp,
          ...(stack && stack.length > 0 ? { stack } : {}),
          ...(args.length > 0 ? { args } : {}),
        };
      }
      case 'Runtime.exceptionThrown': {
        const details = (
          params as {
            exceptionDetails?: {
              text?: string;
              url?: string;
              lineNumber?: number;
              columnNumber?: number;
              stackTrace?: unknown;
              exception?: unknown;
            };
          }
        ).exceptionDetails;

        const exception = this.toRemoteObjectSummary(details?.exception);
        const stack = this.toStackFrames(details?.stackTrace);
        const source =
          this.toSourceLocation({
            url: details?.url,
            lineNumber: details?.lineNumber,
            columnNumber: details?.columnNumber,
          }) ??
          // If the top frame exists, treat it as the source.
          (stack && stack.length > 0
            ? {
                url: stack[0].url,
                line: stack[0].line,
                column: stack[0].column,
              }
            : undefined);

        const baseText =
          typeof details?.text === 'string' && details.text.trim().length > 0
            ? details.text
            : 'Uncaught exception';
        const exceptionDesc =
          typeof exception?.description === 'string' &&
          exception.description.trim().length > 0
            ? exception.description
            : undefined;

        // CDP often reports `exceptionDetails.text` as just "Uncaught".
        // Enrich the message with the exception description when available.
        const text =
          baseText === 'Uncaught' && exceptionDesc
            ? `Uncaught: ${exceptionDesc}`
            : baseText;

        return {
          level: 'error',
          text,
          timestamp: event.timestamp,
          ...(source ? { source } : {}),
          ...(stack && stack.length > 0 ? { stack } : {}),
          ...(exception ? { exception } : {}),
        };
      }
      case 'Log.entryAdded': {
        const entry = (
          params as {
            entry?: {
              level?: string;
              text?: string;
              url?: string;
              lineNumber?: number;
              stackTrace?: unknown;
              timestamp?: number;
            };
          }
        ).entry;
        if (!entry) {
          return null;
        }
        const stack = this.toStackFrames(entry.stackTrace);
        const source = this.toSourceLocation({
          url: entry.url,
          lineNumber: entry.lineNumber,
          columnNumber: undefined,
        });
        return {
          level: entry.level ?? 'log',
          text: entry.text ?? '',
          timestamp: event.timestamp,
          ...(source ? { source } : {}),
          ...(stack && stack.length > 0 ? { stack } : {}),
        };
      }
      default:
        return null;
    }
  }

  private toSourceLocation(input: {
    url?: unknown;
    lineNumber?: unknown;
    columnNumber?: unknown;
  }): { url?: string; line?: number; column?: number } | undefined {
    const url =
      typeof input.url === 'string' && input.url.length > 0
        ? input.url
        : undefined;
    const line =
      typeof input.lineNumber === 'number' && Number.isFinite(input.lineNumber)
        ? Math.max(1, Math.floor(input.lineNumber) + 1)
        : undefined;
    const column =
      typeof input.columnNumber === 'number' &&
      Number.isFinite(input.columnNumber)
        ? Math.max(1, Math.floor(input.columnNumber) + 1)
        : undefined;
    if (!url && !line && !column) {
      return undefined;
    }
    return {
      ...(url ? { url } : {}),
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
    };
  }

  private toStackFrames(stackTrace: unknown):
    | Array<{
        functionName?: string;
        url?: string;
        line?: number;
        column?: number;
      }>
    | undefined {
    const frames: Array<{
      functionName?: string;
      url?: string;
      line?: number;
      column?: number;
    }> = [];

    const collect = (trace: unknown): void => {
      if (!trace || typeof trace !== 'object') {
        return;
      }
      const callFrames = (trace as { callFrames?: unknown }).callFrames;
      if (Array.isArray(callFrames)) {
        for (const frame of callFrames) {
          if (!frame || typeof frame !== 'object') {
            continue;
          }
          const functionName =
            typeof (frame as { functionName?: unknown }).functionName ===
            'string'
              ? String((frame as { functionName?: unknown }).functionName)
              : undefined;
          const url =
            typeof (frame as { url?: unknown }).url === 'string'
              ? String((frame as { url?: unknown }).url)
              : undefined;
          const lineNumber = (frame as { lineNumber?: unknown }).lineNumber;
          const columnNumber = (frame as { columnNumber?: unknown })
            .columnNumber;

          const loc = this.toSourceLocation({ url, lineNumber, columnNumber });
          frames.push({
            ...(functionName ? { functionName } : {}),
            ...(loc?.url ? { url: loc.url } : {}),
            ...(loc?.line ? { line: loc.line } : {}),
            ...(loc?.column ? { column: loc.column } : {}),
          });

          if (frames.length >= 50) {
            return;
          }
        }
      }
      const parent = (trace as { parent?: unknown }).parent;
      if (frames.length < 50 && parent) {
        collect(parent);
      }
    };

    collect(stackTrace);
    return frames.length > 0 ? frames : undefined;
  }

  private toRemoteObjectSummary(obj: unknown):
    | {
        type?: string;
        subtype?: string;
        description?: string;
        value?: unknown;
        unserializableValue?: string;
      }
    | undefined {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    const raw = obj as {
      type?: unknown;
      subtype?: unknown;
      description?: unknown;
      value?: unknown;
      unserializableValue?: unknown;
    };
    const type = typeof raw.type === 'string' ? raw.type : undefined;
    const subtype = typeof raw.subtype === 'string' ? raw.subtype : undefined;
    const description =
      typeof raw.description === 'string' ? raw.description : undefined;
    const unserializableValue =
      typeof raw.unserializableValue === 'string'
        ? raw.unserializableValue
        : undefined;

    const out: {
      type?: string;
      subtype?: string;
      description?: string;
      value?: unknown;
      unserializableValue?: string;
    } = {};

    if (type) out.type = type;
    if (subtype) out.subtype = subtype;
    if (description) out.description = description;
    if (raw.value !== undefined) out.value = raw.value;
    if (unserializableValue) out.unserializableValue = unserializableValue;

    return Object.keys(out).length > 0 ? out : undefined;
  }

  private stringifyRemoteObject(value: unknown): string {
    if (!value || typeof value !== 'object') {
      return String(value ?? '');
    }
    const obj = value as {
      value?: unknown;
      description?: string;
      unserializableValue?: string;
      type?: string;
    };
    if (obj.unserializableValue) {
      return obj.unserializableValue;
    }
    if (obj.value !== undefined) {
      try {
        return typeof obj.value === 'string'
          ? obj.value
          : JSON.stringify(obj.value);
      } catch {
        return String(obj.value);
      }
    }
    if (obj.description) {
      return obj.description;
    }
    return obj.type ?? '';
  }

  private buildHar(events: DebuggerEventRecord[], title?: string): unknown {
    type RequestRecord = {
      id: string;
      url?: string;
      method?: string;
      startTime?: number;
      endTime?: number;
      requestHeaders?: Record<string, string>;
      responseHeaders?: Record<string, string>;
      status?: number;
      statusText?: string;
      mimeType?: string;
      encodedDataLength?: number;
      protocol?: string;
    };

    const requests = new Map<string, RequestRecord>();

    const toTimestamp = (
      event: DebuggerEventRecord,
      fallback?: number
    ): number => {
      const raw = (event.params as { timestamp?: number; wallTime?: number })
        ?.wallTime;
      if (typeof raw === 'number') {
        return raw * 1000;
      }
      const ts = (event.params as { timestamp?: number })?.timestamp;
      if (typeof ts === 'number') {
        return ts * 1000;
      }
      const parsed = Date.parse(event.timestamp);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      return fallback ?? Date.now();
    };

    for (const event of events) {
      const params = event.params ?? {};
      switch (event.method) {
        case 'Network.requestWillBeSent': {
          const requestId = String(
            (params as { requestId?: unknown }).requestId
          );
          if (!requestId) {
            break;
          }
          const request = (
            params as {
              request?: {
                url?: string;
                method?: string;
                headers?: Record<string, string>;
              };
            }
          ).request;
          const record: RequestRecord = {
            id: requestId,
            url: request?.url,
            method: request?.method,
            requestHeaders: request?.headers ?? {},
            startTime: toTimestamp(event),
          };
          requests.set(requestId, record);
          break;
        }
        case 'Network.responseReceived': {
          const requestId = String(
            (params as { requestId?: unknown }).requestId
          );
          if (!requestId) {
            break;
          }
          const response = (
            params as {
              response?: {
                status?: number;
                statusText?: string;
                mimeType?: string;
                headers?: Record<string, string>;
                protocol?: string;
              };
            }
          ).response;
          const record = requests.get(requestId) ?? { id: requestId };
          record.status = response?.status;
          record.statusText = response?.statusText;
          record.mimeType = response?.mimeType;
          record.responseHeaders = response?.headers ?? {};
          record.protocol = response?.protocol;
          record.startTime = record.startTime ?? toTimestamp(event);
          requests.set(requestId, record);
          break;
        }
        case 'Network.loadingFinished': {
          const requestId = String(
            (params as { requestId?: unknown }).requestId
          );
          if (!requestId) {
            break;
          }
          const record = requests.get(requestId) ?? { id: requestId };
          record.encodedDataLength = (
            params as { encodedDataLength?: number }
          ).encodedDataLength;
          record.endTime = toTimestamp(event, record.startTime);
          requests.set(requestId, record);
          break;
        }
        case 'Network.loadingFailed': {
          const requestId = String(
            (params as { requestId?: unknown }).requestId
          );
          if (!requestId) {
            break;
          }
          const record = requests.get(requestId) ?? { id: requestId };
          record.endTime = toTimestamp(event, record.startTime);
          requests.set(requestId, record);
          break;
        }
        default:
          break;
      }
    }

    const entries = Array.from(requests.values()).map((record) => {
      const started = record.startTime ?? Date.now();
      const ended = record.endTime ?? started;
      const time = Math.max(0, ended - started);
      const url = record.url ?? '';
      const queryString: Array<{ name: string; value: string }> = [];
      try {
        const parsed = new URL(url);
        parsed.searchParams.forEach((value, name) => {
          queryString.push({ name, value });
        });
      } catch {
        // Ignore URL parse failures.
      }

      return {
        pageref: 'page_0',
        startedDateTime: new Date(started).toISOString(),
        time,
        request: {
          method: record.method ?? 'GET',
          url,
          httpVersion: record.protocol ?? 'HTTP/1.1',
          cookies: [],
          headers: [],
          queryString,
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: record.status ?? 0,
          statusText: record.statusText ?? '',
          httpVersion: record.protocol ?? 'HTTP/1.1',
          cookies: [],
          headers: [],
          redirectURL: '',
          headersSize: -1,
          bodySize: record.encodedDataLength ?? 0,
          content: {
            size: record.encodedDataLength ?? 0,
            mimeType: record.mimeType ?? '',
          },
        },
        cache: {},
        timings: {
          send: 0,
          wait: time,
          receive: 0,
        },
      };
    });

    const startedDateTime = entries.length
      ? entries[0].startedDateTime
      : new Date().toISOString();

    return {
      log: {
        version: '1.2',
        creator: {
          name: 'browser-bridge',
          version: '0.0.0',
        },
        pages: [
          {
            id: 'page_0',
            title: title ?? 'page',
            startedDateTime,
            pageTimings: {
              onContentLoad: -1,
              onLoad: -1,
            },
          },
        ],
        entries,
      },
    };
  }

  private markInspectConnected(sessionId: string): void {
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

  private buildUnavailableError(): InspectError {
    return new InspectError(
      'INSPECT_UNAVAILABLE',
      'Inspect is not available until the debugger bridge is configured.',
      { retryable: false }
    );
  }

  private throwUnavailable(): never {
    const error = this.buildUnavailableError();
    this.recordError(error);
    throw error;
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
