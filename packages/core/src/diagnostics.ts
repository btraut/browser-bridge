import { getArtifactRootDir } from "./artifacts";

export type DiagnosticCheck = {
  name: string;
  ok: boolean;
  message?: string;
  details?: Record<string, unknown>;
};

export type DiagnosticReport = {
  ok: boolean;
  session_id?: string;
  checks?: DiagnosticCheck[];
  extension?: {
    connected?: boolean;
    version?: string;
    last_seen_at?: string;
  };
  artifacts?: {
    root_dir?: string;
  };
  warnings?: string[];
  notes?: string[];
};

export type DiagnosticsContext = {
  sessionState?: string;
  extension?: {
    connected: boolean;
    lastSeenAt?: string;
  };
  driveLastError?: {
    code: string;
    message: string;
    retryable: boolean;
    at: string;
  };
  inspectLastError?: {
    code: string;
    message: string;
    retryable: boolean;
    at: string;
  };
  recoveryAttempt?: {
    sessionId: string;
    recovered: boolean;
    state: string;
    message?: string;
    at: string;
  };
};

export const buildDiagnosticReport = (
  sessionId?: string,
  context: DiagnosticsContext = {}
): DiagnosticReport => {
  const extensionConnected = context.extension?.connected ?? false;
  const sessionState = context.sessionState;

  const checks: DiagnosticCheck[] = [
    {
      name: "extension.connected",
      ok: extensionConnected,
      message: extensionConnected
        ? "Extension is connected."
        : "Extension is not connected.",
    },
    {
      name: "session.state",
      ok: Boolean(sessionState),
      message: sessionState
        ? `Session state is ${sessionState}.`
        : sessionId
        ? "Session state unavailable."
        : "Session id not provided.",
      details: {
        session_id: sessionId || null,
        state: sessionState ?? "UNKNOWN",
      },
    },
  ];

  if (context.driveLastError) {
    checks.push({
      name: "drive.last_error",
      ok: false,
      message: context.driveLastError.message,
      details: {
        code: context.driveLastError.code,
        retryable: context.driveLastError.retryable,
        at: context.driveLastError.at,
      },
    });
  }

  if (context.inspectLastError) {
    checks.push({
      name: "inspect.last_error",
      ok: false,
      message: context.inspectLastError.message,
      details: {
        code: context.inspectLastError.code,
        retryable: context.inspectLastError.retryable,
        at: context.inspectLastError.at,
      },
    });
  }

  if (context.recoveryAttempt) {
    checks.push({
      name: "recovery.last_attempt",
      ok: context.recoveryAttempt.recovered,
      message: context.recoveryAttempt.message ?? "Recovery attempt recorded.",
      details: {
        session_id: context.recoveryAttempt.sessionId,
        state: context.recoveryAttempt.state,
        at: context.recoveryAttempt.at,
      },
    });
  }

  const report: DiagnosticReport = {
    ok: checks.every((check) => check.ok),
    session_id: sessionId,
    checks,
    extension: {
      connected: extensionConnected,
      last_seen_at: context.extension?.lastSeenAt,
    },
    artifacts: sessionId
      ? {
          root_dir: getArtifactRootDir(sessionId),
        }
      : undefined,
    notes: ["Diagnostics include runtime status; some checks may be stubbed."],
  };

  return report;
};
