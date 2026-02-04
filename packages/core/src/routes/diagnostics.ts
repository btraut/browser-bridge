import { DiagnosticsContext, buildDiagnosticReport } from "../diagnostics";
import type { SessionRegistry } from "../session";
import type { ExtensionBridge } from "../extension-bridge";
import type { DriveController } from "../drive";
import type { InspectService } from "../inspect";
import type { DebuggerBridge } from "../debugger-bridge";
import type { RecoveryTracker } from "../recovery";

type RequestLike = {
  body?: unknown;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

type RouteRegistry = {
  post: (path: string, handler: (req: RequestLike, res: ResponseLike) => void) => void;
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
    code: "INVALID_ARGUMENT" | "INTERNAL";
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type SuccessEnvelope<T> = {
  ok: true;
  result: T;
};

const sendError = (
  res: ResponseLike,
  status: number,
  error: ErrorEnvelope["error"]
): void => {
  res.status(status).json({ ok: false, error });
};

const sendResult = <T>(res: ResponseLike, result: T): void => {
  const envelope: SuccessEnvelope<T> = { ok: true, result };
  res.status(200).json(envelope);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const registerDiagnosticsRoutes = (
  router: RouteRegistry,
  options: DiagnosticsRoutesOptions = {}
): void => {
  router.post("/diagnostics/doctor", (req, res) => {
    let sessionId: string | undefined;
    if (req.body !== undefined) {
      if (!isRecord(req.body)) {
        sendError(res, 400, {
          code: "INVALID_ARGUMENT",
          message: "Request body must be an object.",
          retryable: false,
        });
        return;
      }
      const raw = req.body.session_id;
      if (raw !== undefined && (typeof raw !== "string" || raw.length === 0)) {
        sendError(res, 400, {
          code: "INVALID_ARGUMENT",
          message: "session_id must be a non-empty string.",
          retryable: false,
          details: { field: "session_id" },
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
          idleTimeoutMs: settings.idleTimeoutMs,
          consoleBufferSize: settings.consoleBufferSize,
          networkBufferSize: settings.networkBufferSize,
          lastError: lastError
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
      }

      const report = buildDiagnosticReport(sessionId, context);
      sendResult(res, report);
    } catch {
      sendError(res, 500, {
        code: "INTERNAL",
        message: "Failed to build diagnostics report.",
        retryable: false,
      });
    }
  });
};
