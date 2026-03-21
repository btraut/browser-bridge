import type { DriveAction, DriveErrorInfo } from './drive-protocol';
import {
  ExtensionBridge,
  ExtensionBridgeError,
  toDriveError,
} from './extension-bridge';
import { SessionError, SessionRegistry } from './session';
import { SessionState, shouldRetryDriveOp } from './state';

export type DriveResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: DriveErrorInfo };

const LOOPBACK_NAVIGATION_PREFLIGHT_TIMEOUT_MS = 1200;
const POST_CLICK_SETTLE_MS = 75;
const TRANSIENT_LOCATOR_RETRY_DELAYS_MS = [150, 300, 600] as const;
const EXTENSION_READY_WAIT_MS = 1500;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ACTIONS_WITH_OPTIONAL_TAB_ID = new Set<DriveAction>([
  'drive.navigate',
  'drive.go_back',
  'drive.go_forward',
  'drive.click',
  'drive.hover',
  'drive.select',
  'drive.type',
  'drive.fill_form',
  'drive.drag',
  'drive.handle_dialog',
  'drive.key',
  'drive.key_press',
  'drive.scroll',
  'drive.screenshot',
  'drive.wait_for',
]);

const isLikelyUnreachableLoopbackError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('connection refused') ||
    normalized.includes('econnrefused') ||
    normalized.includes('err_connection_refused') ||
    normalized.includes('enotfound') ||
    normalized.includes('err_name_not_resolved') ||
    normalized.includes('eai_again') ||
    normalized.includes('ehostunreach') ||
    normalized.includes('enetunreach')
  );
};

const preflightLoopbackNavigation = async (
  action: DriveAction,
  params?: Record<string, unknown>
): Promise<DriveErrorInfo | undefined> => {
  if (action !== 'drive.navigate') {
    return undefined;
  }

  const urlValue = params?.url;
  if (typeof urlValue !== 'string' || urlValue.trim().length === 0) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return undefined;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return undefined;
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, LOOPBACK_NAVIGATION_PREFLIGHT_TIMEOUT_MS);

  try {
    await fetch(urlValue, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    return undefined;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return undefined;
    }

    const message =
      error instanceof Error ? error.message : 'Navigation preflight failed.';
    if (!isLikelyUnreachableLoopbackError(message)) {
      return undefined;
    }

    return {
      code: 'NAVIGATION_FAILED',
      message: `Navigation target is unreachable: ${urlValue}`,
      retryable: true,
      retry: {
        retryable: true,
        reason: 'loopback_target_unreachable',
        retry_after_ms: 250,
        max_attempts: 1,
      },
      details: {
        url: urlValue,
        preflight: 'loopback_head',
        reason: message,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

class DriveMutex {
  private tail = Promise.resolve();

  async runExclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return await result;
  }
}

export const driveMutex = new DriveMutex();

export class DriveController {
  private readonly bridge: ExtensionBridge;
  private readonly registry: SessionRegistry;
  private lastError?: DriveErrorInfo;
  private lastErrorAt?: string;

  constructor(bridge: ExtensionBridge, registry: SessionRegistry) {
    this.bridge = bridge;
    this.registry = registry;
  }

  getLastError(): { error: DriveErrorInfo; at: string } | undefined {
    if (!this.lastError || !this.lastErrorAt) {
      return undefined;
    }
    return { error: this.lastError, at: this.lastErrorAt };
  }

  private recordError(error: DriveErrorInfo): void {
    this.lastError = error;
    this.lastErrorAt = new Date().toISOString();
  }

  private clearLastError(): void {
    this.lastError = undefined;
    this.lastErrorAt = undefined;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForBridgeReady(): Promise<boolean> {
    if (this.bridge.isConnected()) {
      return true;
    }
    const waitForReady = (
      this.bridge as ExtensionBridge & {
        waitForReady?: (timeoutMs?: number) => Promise<boolean>;
      }
    ).waitForReady;
    if (typeof waitForReady === 'function') {
      return await waitForReady.call(this.bridge, EXTENSION_READY_WAIT_MS);
    }
    return this.bridge.isConnected();
  }

  private isTransientLocatorError(
    action: DriveAction,
    error: DriveErrorInfo
  ): boolean {
    if (action !== 'drive.click') {
      return false;
    }
    if (error.code.toUpperCase() !== 'NOT_FOUND') {
      return false;
    }
    const reason = error.details?.reason;
    const legacyCode = error.details?.legacy_code;
    const resource = error.details?.resource;
    return (
      reason === 'locator_not_found' ||
      legacyCode === 'LOCATOR_NOT_FOUND' ||
      resource === 'locator'
    );
  }

  async execute<T>(
    sessionId: string,
    action: DriveAction,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<DriveResult<T>> {
    return await driveMutex.runExclusive(async () => {
      let selectedTabId: number | undefined;
      try {
        selectedTabId = this.registry.require(sessionId).selectedTabId;
      } catch (error) {
        if (error instanceof SessionError) {
          const errorInfo: DriveErrorInfo = {
            code: error.code,
            message: error.message,
            retryable: false,
          };
          this.recordError(errorInfo);
          return {
            ok: false,
            error: errorInfo,
          };
        }
        const errorInfo: DriveErrorInfo = {
          code: 'INTERNAL',
          message: 'Unexpected error while validating session.',
          retryable: false,
        };
        this.recordError(errorInfo);
        return {
          ok: false,
          error: errorInfo,
        };
      }

      if (!(await this.waitForBridgeReady())) {
        const errorInfo: DriveErrorInfo = {
          code: 'EXTENSION_DISCONNECTED',
          message:
            'Extension is not connected. Open Chrome with the Browser Bridge extension enabled, then retry.',
          retryable: true,
          retry: {
            retryable: true,
            reason: 'extension_disconnected',
            retry_after_ms: 300,
            max_attempts: 1,
          },
          details: {
            next_step: 'Ensure Chrome is running and extension.connected=true.',
          },
        };
        this.recordError(errorInfo);
        return { ok: false, error: errorInfo };
      }

      this.ensureDriveReady(sessionId);

      const prepared = this.prepareRequestParams(action, params, selectedTabId);
      const requestParams = prepared.params;

      const preflightError = await preflightLoopbackNavigation(
        action,
        requestParams
      );
      if (preflightError) {
        this.recordError(preflightError);
        return {
          ok: false,
          error: preflightError,
        };
      }

      let attempt = 0;
      while (true) {
        try {
          const response = await this.bridge.request<T>(
            action,
            requestParams,
            timeoutMs
          );
          if (response.status === 'ok') {
            if (action === 'drive.click') {
              await this.sleep(POST_CLICK_SETTLE_MS);
            }
            this.applySessionTargetOnSuccess(
              sessionId,
              action,
              requestParams,
              response.result
            );
            this.clearLastError();
            return {
              ok: true,
              result: response.result as T,
            };
          }

          const errorInfo: DriveErrorInfo = response.error ?? {
            code: 'UNKNOWN',
            message: 'Drive operation failed.',
            retryable: false,
            retry: {
              retryable: false,
              reason: 'drive_response_error',
              max_attempts: 1,
            },
          };

          if (
            attempt < TRANSIENT_LOCATOR_RETRY_DELAYS_MS.length &&
            this.isTransientLocatorError(action, errorInfo)
          ) {
            const delayMs = TRANSIENT_LOCATOR_RETRY_DELAYS_MS[attempt] ?? 0;
            attempt += 1;
            await this.sleep(delayMs);
            continue;
          }

          if (
            shouldRetryDriveOp({
              attempt,
              retryable: errorInfo.retryable,
              retry: errorInfo.retry,
            })
          ) {
            attempt += 1;
            continue;
          }

          if (
            prepared.injectedSessionTabId &&
            this.isMissingTabError(errorInfo)
          ) {
            this.clearSessionTarget(sessionId);
          }
          this.recordError(errorInfo);
          return { ok: false, error: errorInfo };
        } catch (error) {
          if (error instanceof ExtensionBridgeError) {
            if (error.code === 'EXTENSION_DISCONNECTED') {
              this.applyDriveDisconnected(sessionId);
            }
            const errorInfo = toDriveError(error);
            if (
              shouldRetryDriveOp({
                attempt,
                retryable: errorInfo.retryable,
                retry: errorInfo.retry,
              })
            ) {
              attempt += 1;
              continue;
            }
            if (
              prepared.injectedSessionTabId &&
              this.isMissingTabError(errorInfo)
            ) {
              this.clearSessionTarget(sessionId);
            }
            this.recordError(errorInfo);
            return { ok: false, error: errorInfo };
          }

          const errorInfo: DriveErrorInfo = {
            code: 'INTERNAL',
            message: 'Unexpected error while executing drive action.',
            retryable: false,
          };
          this.recordError(errorInfo);
          return {
            ok: false,
            error: errorInfo,
          };
        }
      }
    });
  }

  private readTabId(params?: Record<string, unknown>): number | undefined {
    const value = params?.tab_id;
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private readTabIdFromResult(result: unknown): number | undefined {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return undefined;
    }
    const value = (result as { tab_id?: unknown }).tab_id;
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private prepareRequestParams(
    action: DriveAction,
    params: Record<string, unknown> | undefined,
    selectedTabId: number | undefined
  ): { params?: Record<string, unknown>; injectedSessionTabId: boolean } {
    if (!ACTIONS_WITH_OPTIONAL_TAB_ID.has(action)) {
      return { params, injectedSessionTabId: false };
    }

    if (!selectedTabId || selectedTabId <= 0) {
      return { params, injectedSessionTabId: false };
    }

    const explicitTabId = this.readTabId(params);
    if (explicitTabId !== undefined) {
      return { params, injectedSessionTabId: false };
    }

    return {
      params: { ...(params ?? {}), tab_id: selectedTabId },
      injectedSessionTabId: true,
    };
  }

  private applySessionTargetOnSuccess(
    sessionId: string,
    action: DriveAction,
    params?: Record<string, unknown>,
    result?: unknown
  ): void {
    const tabId = this.readTabIdFromResult(result) ?? this.readTabId(params);
    if (tabId === undefined) {
      return;
    }
    try {
      if (action === 'drive.tab_close') {
        const session = this.registry.require(sessionId);
        if (session.selectedTabId === tabId) {
          this.registry.clearSelectedTab(sessionId);
        }
        return;
      }
      if (
        action === 'drive.tab_activate' ||
        ACTIONS_WITH_OPTIONAL_TAB_ID.has(action)
      ) {
        this.registry.setSelectedTab(sessionId, tabId);
      }
    } catch (error) {
      console.debug(
        `Drive target update ignored for session ${sessionId}.`,
        error
      );
    }
  }

  private isMissingTabError(error: DriveErrorInfo): boolean {
    const code = error.code.toUpperCase();
    if (code === 'TAB_NOT_FOUND') {
      return true;
    }
    const resource = error.details?.resource;
    return (
      code === 'NOT_FOUND' && (resource === undefined || resource === 'tab')
    );
  }

  private clearSessionTarget(sessionId: string): void {
    try {
      this.registry.clearSelectedTab(sessionId);
    } catch (error) {
      console.debug(
        `Drive target clear ignored for session ${sessionId}.`,
        error
      );
    }
  }

  private ensureDriveReady(sessionId: string): void {
    try {
      const session = this.registry.require(sessionId);
      if (session.state === SessionState.INIT) {
        this.registry.apply(sessionId, 'DRIVE_CONNECTED');
      } else if (session.state === SessionState.INSPECT_READY) {
        this.registry.apply(sessionId, 'DRIVE_CONNECTED');
      } else if (session.state === SessionState.DEGRADED_DRIVE) {
        this.registry.apply(sessionId, 'RECOVER_SUCCEEDED');
      }
    } catch (error) {
      console.debug(
        `Drive ready transition ignored for session ${sessionId}.`,
        error
      );
    }
  }

  private applyDriveDisconnected(sessionId: string): void {
    try {
      const session = this.registry.require(sessionId);
      if (session.state === SessionState.READY) {
        this.registry.apply(sessionId, 'DRIVE_DISCONNECTED');
      }
    } catch (error) {
      console.debug(
        `Drive disconnect transition ignored for session ${sessionId}.`,
        error
      );
    }
  }
}
