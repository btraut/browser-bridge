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
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

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

  async execute<T>(
    sessionId: string,
    action: DriveAction,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<DriveResult<T>> {
    return await driveMutex.runExclusive(async () => {
      try {
        this.registry.require(sessionId);
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

      if (!this.bridge.isConnected()) {
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

      const preflightError = await preflightLoopbackNavigation(action, params);
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
            params,
            timeoutMs
          );
          if (response.status === 'ok') {
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
            shouldRetryDriveOp({
              attempt,
              retryable: errorInfo.retryable,
              retry: errorInfo.retry,
            })
          ) {
            attempt += 1;
            continue;
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
