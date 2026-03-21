import { randomUUID } from 'crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PageStateSchema } from '@btraut/browser-bridge-shared';
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
  filterAxSnapshotByRefs,
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
import {
  parseExtractContentSource,
  renderExtractContent,
} from './extract-content-policy';
import { buildHar } from './har';
import { captureHtml } from './html-snapshot';
import { SnapshotHistory } from './snapshot-history';
import {
  applySnapshotRefAttributes,
  assignRefsToAxSnapshot,
  clearSnapshotRefArtifacts,
  persistSnapshotRefRegistry,
  pruneUnappliedRefsFromSnapshot,
  resolveNodeIdForSelector,
} from './snapshot-refs';
import { InspectError } from './errors';
import { selectInspectTab } from './target-selection';
import type {
  ArtifactInfo,
  ConsoleEntry,
  ConsoleListResult,
  DomSnapshotResult,
  EvaluateResult,
  ExtractContentResult,
  InspectErrorCode,
  InspectServiceOptions,
  PageStateResult,
  PerformanceMetricsResult,
} from './types';
import { buildPageStateScript } from '../page-state-script';
import { SessionError, SessionRegistry, SessionRecord } from '../session';
import { SessionState } from '../state';
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
  private readonly consoleSinceBySessionTab = new Map<string, string>();

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
      const selection = await this.resolveTab(sessionId);
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
    const selection = await this.resolveTab(input.sessionId, input.targetHint);
    const debuggerCommand = this.debuggerCommand.bind(this);
    const executionContextId = await this.resolveMainFrameExecutionContextId(
      selection.tabId
    );

    const work = async (): Promise<DomSnapshotResult> => {
      if (input.format === 'html') {
        const html = await captureHtml(selection.tabId, {
          selector: input.selector,
          debuggerCommand,
          executionContextId,
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
            const refWarnings = (
              await clearSnapshotRefArtifacts(selection.tabId, debuggerCommand)
            ).warnings;
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
        const clearResult = await clearSnapshotRefArtifacts(
          selection.tabId,
          debuggerCommand
        );
        const refResult = await applySnapshotRefAttributes(
          selection.tabId,
          refMap,
          debuggerCommand
        );
        let actionableRefs = refResult.appliedRefs;
        let actionableBindings = refResult.appliedBindings;
        const actionabilityWarnings: string[] = [];
        if (input.interactive && refResult.appliedBindings.length > 0) {
          const actionableResult = await this.collectActionableSnapshotRefs(
            selection.tabId,
            refResult.appliedBindings
          );
          actionabilityWarnings.push(...actionableResult.warnings);
          if (actionableResult.actionableRefs) {
            actionableRefs = actionableResult.actionableRefs;
            actionableBindings = refResult.appliedBindings.filter((binding) =>
              actionableRefs.has(binding.ref)
            );
            snapshot = filterAxSnapshotByRefs(snapshot, actionableRefs);
          }
        }
        const persistResult =
          refMap.size === 0
            ? { warnings: [] as string[] }
            : await persistSnapshotRefRegistry(
                selection.tabId,
                actionableBindings,
                debuggerCommand
              );
        pruneUnappliedRefsFromSnapshot(snapshot, actionableRefs);
        const warnings = [
          ...(selection.warnings ?? []),
          ...selectorWarnings,
          ...truncationWarnings,
          ...clearResult.warnings,
          ...refResult.warnings,
          ...actionabilityWarnings,
          ...persistResult.warnings,
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
            executionContextId,
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
    since?: string;
    targetHint?: TargetHint;
  }): Promise<ConsoleListResult> {
    const session = this.requireSession(input.sessionId);
    const tabCount = this.extensionBridge?.getStatus().tabs.length ?? 0;
    if (
      !input.targetHint &&
      typeof session.selectedTabId !== 'number' &&
      tabCount > 1
    ) {
      const error = new InspectError(
        'TAB_NOT_FOUND',
        'Console inspection requires an explicit target or a session-selected tab.',
        { retryable: false }
      );
      this.recordError(error);
      throw error;
    }
    const selection = await this.resolveTab(input.sessionId, input.targetHint);
    await this.enableConsole(selection.tabId);

    const since = this.resolveConsoleSince({
      session,
      tabId: selection.tabId,
      requestedSince: input.since,
      tabLastActiveAt: selection.tab.last_active_at,
    });
    const events = this.ensureDebugger().getConsoleEvents(selection.tabId);
    const entries = events
      .filter((event) => this.isEventOnOrAfter(event.timestamp, since))
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
    const selection = await this.resolveTab(input.sessionId, input.targetHint);
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
    const selection = await this.resolveTab(input.sessionId, input.targetHint);
    const expression = input.expression ?? 'undefined';

    const result = await this.evaluateInMainFrame(selection.tabId, expression);

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
    consistency?: 'best_effort' | 'quiesce';
    includeMetadata?: boolean;
    targetHint?: TargetHint;
  }): Promise<ExtractContentResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.sessionId, input.targetHint);
    const consistency = input.consistency ?? 'quiesce';

    const debuggerCommand = this.debuggerCommand.bind(this);
    const executionContextId = await this.resolveMainFrameExecutionContextId(
      selection.tabId
    );
    const url = selection.tab.url ?? 'about:blank';
    const work = async (): Promise<ExtractContentResult> => {
      if (consistency === 'quiesce') {
        await this.waitForDomSettled(selection.tabId, executionContextId);
      }
      const html = await captureHtml(selection.tabId, {
        debuggerCommand,
        executionContextId,
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
      try {
        const { article, semanticMainCandidate } = parseExtractContentSource({
          html,
          url,
        });
        return renderExtractContent({
          format: input.format,
          article,
          semanticMainCandidate,
          includeMetadata: input.includeMetadata,
          warnings: selection.warnings,
        });
      } catch (error) {
        if (error instanceof InspectError) {
          this.recordError(error);
        }
        throw error;
      }
    };

    const output =
      consistency === 'quiesce'
        ? await driveMutex.runExclusive(work)
        : await work();
    this.markInspectConnected(input.sessionId);
    return output;
  }

  async pageState(input: {
    sessionId: string;
    includeValues?: boolean;
    targetHint?: TargetHint;
  }): Promise<PageStateResult> {
    this.requireSession(input.sessionId);
    const selection = await this.resolveTab(input.sessionId, input.targetHint);

    const result = await this.evaluateInMainFrame(
      selection.tabId,
      buildPageStateScript({ includeValues: input.includeValues })
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
    const parsed = PageStateSchema.safeParse(value);
    if (!parsed.success) {
      const error = new InspectError(
        'EVALUATION_FAILED',
        'Captured page state did not match the expected schema.',
        { retryable: false }
      );
      this.recordError(error);
      throw error;
    }
    const warnings = [
      ...(parsed.data.warnings ?? []),
      ...(selection.warnings ?? []),
    ];
    const output: PageStateResult = {
      ...parsed.data,
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
    const selection = await this.resolveTab(input.sessionId, input.targetHint);

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
    const selection = await this.resolveTab(input.sessionId, input.targetHint);

    const format = input.format ?? 'png';
    const createScreenshotError = (
      code: InspectErrorCode,
      message: string,
      retryable = false,
      details?: Record<string, unknown>
    ): InspectError =>
      new InspectError(code, message, {
        retryable,
        ...(details ? { details } : {}),
      });
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
    const captureViaExtension = async (
      mode: 'viewport' | 'full_page' | 'element',
      failureMessage: string
    ): Promise<ArtifactInfo> => {
      if (!this.extensionBridge?.request) {
        throw createScreenshotError(
          'NOT_SUPPORTED',
          'Screenshots require an extension that supports drive.screenshot.'
        );
      }

      const response =
        await this.extensionBridge.request<DriveScreenshotResult>(
          'drive.screenshot',
          {
            tab_id: selection.tabId,
            mode,
            ...(input.selector ? { selector: input.selector } : {}),
            format,
            ...(typeof input.quality === 'number'
              ? { quality: input.quality }
              : {}),
          },
          120000
        );

      if (response.status === 'error') {
        const error = createScreenshotError(
          (response.error?.code as InspectErrorCode) ?? 'INSPECT_UNAVAILABLE',
          response.error?.message ?? failureMessage,
          response.error?.retryable ?? false,
          response.error?.details
        );
        this.recordError(error);
        throw error;
      }

      const result = response.result;
      if (!result?.data_base64 || typeof result.data_base64 !== 'string') {
        const error = createScreenshotError(
          'INSPECT_UNAVAILABLE',
          failureMessage
        );
        this.recordError(error);
        throw error;
      }

      return await writeArtifact(result.data_base64);
    };
    const shouldFallbackFromExtensionScreenshot = (
      error: InspectError
    ): boolean =>
      [
        'NOT_SUPPORTED',
        'NOT_IMPLEMENTED',
        'INSPECT_UNAVAILABLE',
        'PERMISSION_REQUIRED',
        'RATE_LIMITED',
      ].includes(error.code);
    const shouldPreserveExtensionScreenshotError = (
      fallbackError: InspectError
    ): boolean =>
      [
        'INSPECT_UNAVAILABLE',
        'ATTACH_DENIED',
        'NOT_SUPPORTED',
        'NOT_IMPLEMENTED',
      ].includes(fallbackError.code);
    const captureViaDebugger = async (): Promise<ArtifactInfo> => {
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
    };

    if (input.selector) {
      return await captureViaExtension(
        'element',
        'Failed to capture element screenshot.'
      );
    }

    let extensionScreenshotError: InspectError | undefined;
    if (this.extensionBridge?.request) {
      try {
        return await captureViaExtension(
          input.target === 'full' ? 'full_page' : 'viewport',
          input.target === 'full'
            ? 'Failed to capture full page screenshot.'
            : 'Failed to capture viewport screenshot.'
        );
      } catch (error) {
        if (!(error instanceof InspectError)) {
          throw error;
        }
        if (!shouldFallbackFromExtensionScreenshot(error)) {
          throw error;
        }
        extensionScreenshotError = error;
      }
    }

    try {
      return await captureViaDebugger();
    } catch (error) {
      if (
        extensionScreenshotError &&
        error instanceof InspectError &&
        shouldPreserveExtensionScreenshotError(error)
      ) {
        this.recordError(extensionScreenshotError);
        throw extensionScreenshotError;
      }
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
    sessionId?: string,
    hint?: TargetHint
  ): Promise<{ tabId: number; tab: DriveTabInfo; warnings?: string[] }> {
    try {
      return selectInspectTab({
        sessionId,
        targetHint: hint,
        registry: this.registry,
        extensionBridge: this.extensionBridge,
      });
    } catch (error) {
      if (error instanceof InspectError) {
        this.recordError(error);
      }
      throw error;
    }
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

  private async collectActionableSnapshotRefs(
    tabId: number,
    bindings: Array<{ ref: string }>
  ): Promise<{
    actionableRefs?: Set<string>;
    warnings: string[];
  }> {
    try {
      const result = await this.debuggerCommand(tabId, 'Runtime.evaluate', {
        expression: `(() => {
          const refs = new Set(${JSON.stringify(
            bindings.map((binding) => binding.ref)
          )});
          const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) {
              return false;
            }
            const style = window.getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none') {
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
              return false;
            }
            if (
              element.offsetWidth === 0 &&
              element.offsetHeight === 0 &&
              element.getClientRects().length === 0
            ) {
              return false;
            }
            let current = element;
            while (current) {
              const currentStyle = window.getComputedStyle(current);
              if (currentStyle.display === 'none') {
                return false;
              }
              if (
                currentStyle.visibility === 'hidden' ||
                currentStyle.visibility === 'collapse'
              ) {
                return false;
              }
              const opacity = Number.parseFloat(currentStyle.opacity ?? '1');
              if (Number.isFinite(opacity) && opacity <= 0) {
                return false;
              }
              if (currentStyle.pointerEvents === 'none') {
                return false;
              }
              current = current.parentElement;
            }
            return true;
          };

          return Array.from(document.querySelectorAll('[data-bv-ref]'))
            .filter((element) => {
              const ref = element.getAttribute('data-bv-ref');
              return typeof ref === 'string' && refs.has(ref) && isVisible(element);
            })
            .map((element) => element.getAttribute('data-bv-ref'));
        })() /* browser-bridge:collect-actionable-snapshot-refs */`,
        returnByValue: true,
        awaitPromise: true,
      });
      const rawRefs = (result as { value?: unknown }).value;
      if (!Array.isArray(rawRefs)) {
        return {
          warnings: [
            'Interactive AX snapshot could not verify live actionability.',
          ],
        };
      }
      const refs = rawRefs.filter(
        (ref): ref is string => typeof ref === 'string'
      );
      return {
        actionableRefs: new Set(refs),
        warnings: [],
      };
    } catch {
      return {
        warnings: ['Interactive AX snapshot could not prune hidden controls.'],
      };
    }
  }

  private async waitForDomSettled(
    tabId: number,
    executionContextId?: number
  ): Promise<void> {
    const result = await this.debuggerCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const quietMs = 100;
        const timeoutMs = 2000;
        return new Promise((resolve) => {
          const doc = document;
          const root = doc.documentElement || doc.body || doc;
          let finished = false;
          let quietTimer;
          let timeoutTimer;
          let raf1 = 0;
          let raf2 = 0;
          const finish = () => {
            if (finished) {
              return;
            }
            finished = true;
            if (observer) {
              observer.disconnect();
            }
            clearTimeout(quietTimer);
            clearTimeout(timeoutTimer);
            if (raf1) cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
            resolve(true);
          };
          const scheduleQuiet = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => {
              raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(finish);
              });
            }, quietMs);
          };
          const observer =
            typeof MutationObserver === 'function'
              ? new MutationObserver(() => {
                  scheduleQuiet();
                })
              : null;
          if (observer && root) {
            observer.observe(root, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            });
          }
          scheduleQuiet();
          timeoutTimer = setTimeout(finish, timeoutMs);
        });
      })()`,
      returnByValue: true,
      awaitPromise: true,
      ...(typeof executionContextId === 'number'
        ? { contextId: executionContextId }
        : {}),
    });
    if (result && typeof result === 'object' && 'exceptionDetails' in result) {
      const error = new InspectError(
        'EVALUATION_FAILED',
        'Failed while waiting for the page to settle.',
        { retryable: false }
      );
      this.recordError(error);
      throw error;
    }
  }

  private async evaluateInMainFrame(
    tabId: number,
    expression: string
  ): Promise<unknown> {
    await this.debuggerCommand(tabId, 'Runtime.enable', {});
    const executionContextId =
      await this.resolveMainFrameExecutionContextId(tabId);
    return await this.debuggerCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(typeof executionContextId === 'number'
        ? { contextId: executionContextId }
        : {}),
    });
  }

  private async resolveMainFrameExecutionContextId(
    tabId: number
  ): Promise<number | undefined> {
    const debuggerBridge = this.ensureDebugger();
    const runOptional = async (
      method: string,
      params?: Record<string, unknown>
    ): Promise<unknown | undefined> => {
      const result = await debuggerBridge.command(tabId, method, params);
      if (!result.ok) {
        return undefined;
      }
      return result.result;
    };

    await runOptional('Page.enable', {});
    const frameTree = await runOptional('Page.getFrameTree', {});
    const frameId = (
      frameTree as {
        frameTree?: { frame?: { id?: unknown } };
      }
    )?.frameTree?.frame?.id;

    if (typeof frameId !== 'string' || frameId.length === 0) {
      return undefined;
    }

    const isolatedWorld = await runOptional('Page.createIsolatedWorld', {
      frameId,
      worldName: 'browser_bridge_inspect',
    });
    const contextId = (
      isolatedWorld as { executionContextId?: unknown } | undefined
    )?.executionContextId;
    return typeof contextId === 'number' ? contextId : undefined;
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

  private resolveConsoleSince(options: {
    session: SessionRecord;
    tabId: number;
    requestedSince?: string;
    tabLastActiveAt?: string;
  }): string {
    if (typeof options.requestedSince === 'string') {
      return options.requestedSince;
    }
    const key = `${options.session.id}:${options.tabId}`;
    const existing = this.consoleSinceBySessionTab.get(key);
    if (existing) {
      return existing;
    }
    const candidates = [options.session.createdAt.toISOString()];
    if (typeof options.tabLastActiveAt === 'string') {
      candidates.push(options.tabLastActiveAt);
    }
    const baseline = candidates
      .map((value) => ({ value, time: Date.parse(value) }))
      .filter((entry) => Number.isFinite(entry.time))
      .sort((a, b) => b.time - a.time)[0]?.value;
    const resolved = baseline ?? options.session.createdAt.toISOString();
    this.consoleSinceBySessionTab.set(key, resolved);
    return resolved;
  }

  private isEventOnOrAfter(timestamp: string, since: string): boolean {
    const eventTime = Date.parse(timestamp);
    const sinceTime = Date.parse(since);
    if (!Number.isFinite(eventTime) || !Number.isFinite(sinceTime)) {
      return true;
    }
    return eventTime >= sinceTime;
  }
}

export const createInspectService = (
  options: InspectServiceOptions
): InspectService => new InspectService(options);
