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

      if (this.bridge.isConnected()) {
        this.ensureDriveReady(sessionId);
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
            return {
              ok: true,
              result: response.result as T,
            };
          }

          const errorInfo: DriveErrorInfo = response.error ?? {
            code: 'UNKNOWN',
            message: 'Drive operation failed.',
            retryable: false,
          };

          if (shouldRetryDriveOp({ attempt, retryable: errorInfo.retryable })) {
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
              shouldRetryDriveOp({ attempt, retryable: errorInfo.retryable })
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
    } catch {
      // Ignore invalid transitions.
    }
  }

  private applyDriveDisconnected(sessionId: string): void {
    try {
      const session = this.registry.require(sessionId);
      if (session.state === SessionState.READY) {
        this.registry.apply(sessionId, 'DRIVE_DISCONNECTED');
      }
    } catch {
      // Ignore invalid transitions.
    }
  }
}
