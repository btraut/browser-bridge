import { DiagnosticsContext, buildDiagnosticReport } from '../diagnostics';
import type { SessionRegistry } from '../session';
import type { ExtensionBridge } from '../extension-bridge';
import type { DriveController } from '../drive';
import type { InspectService } from '../inspect';
import type { DebuggerBridge } from '../debugger-bridge';
import type { RecoveryTracker } from '../recovery';
import { ResponseLike, isRecord, sendError, sendResult } from './shared';

type RequestLike = {
  body?: unknown;
};

type RouteRegistry = {
  post: (
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => void
  ) => void;
};

type DiagnosticsRoutesOptions = {
  registry?: SessionRegistry;
  extensionBridge?: ExtensionBridge;
  debuggerBridge?: DebuggerBridge;
  drive?: DriveController;
  inspectService?: InspectService;
  recoveryTracker?: RecoveryTracker;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: 'INVALID_ARGUMENT' | 'INTERNAL';
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

export const registerDiagnosticsRoutes = (
  router: RouteRegistry,
  options: DiagnosticsRoutesOptions = {}
): void => {
  router.post('/diagnostics/doctor', (req, res) => {
    let sessionId: string | undefined;
    if (req.body !== undefined) {
      if (!isRecord(req.body)) {
        sendError(res, 400, {
          code: 'INVALID_ARGUMENT',
          message: 'Request body must be an object.',
          retryable: false,
        });
        return;
      }
      const raw = req.body.session_id;
      if (raw !== undefined && (typeof raw !== 'string' || raw.length === 0)) {
        sendError(res, 400, {
          code: 'INVALID_ARGUMENT',
          message: 'session_id must be a non-empty string.',
          retryable: false,
          details: { field: 'session_id' },
        });
        return;
      }
      sessionId = raw as string | undefined;
    }

    try {
      const context: DiagnosticsContext = {};
      if (options.registry && sessionId) {
        try {
          const session = options.registry.require(sessionId);
          context.sessionState = session.state;
        } catch {
          // Ignore missing session for diagnostics.
        }
      }

      if (options.extensionBridge) {
        const status = options.extensionBridge.getStatus();
        context.extension = {
          connected: status.connected,
          lastSeenAt: status.lastSeenAt,
        };
      }

      if (options.debuggerBridge) {
        const settings = options.debuggerBridge.getSettings();
        const lastError = options.debuggerBridge.getLastError();
        context.debugger = {
          attached: options.debuggerBridge.hasAttachments(),
          idle_timeout_ms: settings.idleTimeoutMs,
          console_buffer_size: settings.consoleBufferSize,
          network_buffer_size: settings.networkBufferSize,
          last_error: lastError
            ? {
                code: lastError.error.code,
                message: lastError.error.message,
                retryable: lastError.error.retryable,
                details: lastError.error.details,
              }
            : undefined,
        };
      }

      if (options.drive) {
        const lastError = options.drive.getLastError();
        if (lastError) {
          context.driveLastError = {
            code: lastError.error.code,
            message: lastError.error.message,
            retryable: lastError.error.retryable,
            at: lastError.at,
          };
        }
      }

      if (options.inspectService) {
        const lastError = options.inspectService.getLastError();
        if (lastError) {
          context.inspectLastError = {
            code: lastError.error.code,
            message: lastError.error.message,
            retryable: lastError.error.retryable,
            at: lastError.at,
          };
        }
      }

      if (options.recoveryTracker) {
        const attempt = options.recoveryTracker.getLastAttempt();
        if (attempt) {
          context.recoveryAttempt = {
            sessionId: attempt.sessionId,
            recovered: attempt.recovered,
            state: attempt.state,
            message: attempt.message,
            at: attempt.at,
          };
        }
        context.recoveryMetrics = options.recoveryTracker.getMetrics();
      }

      const report = buildDiagnosticReport(sessionId, context);
      sendResult(res, report);
    } catch {
      sendError(res, 500, {
        code: 'INTERNAL',
        message: 'Failed to build diagnostics report.',
        retryable: false,
      });
    }
  });
};
