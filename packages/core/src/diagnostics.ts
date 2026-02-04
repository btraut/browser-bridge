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
  chrome?: {
    path?: string;
    version?: string;
    reachable?: boolean;
  };
  extension?: {
    connected?: boolean;
    version?: string;
    last_seen_at?: string;
  };
  cdp?: {
    connected?: boolean;
    target_url?: string;
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
  cdp?: {
    connected: boolean;
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

const CHROME_PATH_PLACEHOLDER = "CHROME_PATH_UNSET";

const resolveChromePath = (): { value: string; configured: boolean } => {
  const envValue =
    process.env.BROWSER_VISION_CHROME_PATH || process.env.CHROME_PATH;
  return {
    value: envValue || CHROME_PATH_PLACEHOLDER,
    configured: Boolean(envValue),
  };
};

export const buildDiagnosticReport = (
  sessionId?: string,
  context: DiagnosticsContext = {}
): DiagnosticReport => {
  const chromePath = resolveChromePath();
  const extensionConnected = context.extension?.connected ?? false;
  const cdpConnected = context.cdp?.connected ?? false;
  const sessionState = context.sessionState;

  const checks: DiagnosticCheck[] = [
    {
      name: "chrome.path",
      ok: chromePath.configured,
      message: chromePath.configured
        ? "Chrome path configured."
        : "Chrome path is not configured.",
      details: {
        path: chromePath.value,
      },
    },
    {
      name: "extension.connected",
      ok: extensionConnected,
      message: extensionConnected
        ? "Extension is connected."
        : "Extension is not connected.",
    },
    {
      name: "cdp.connected",
      ok: cdpConnected,
      message: cdpConnected ? "CDP is connected." : "CDP is not connected.",
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
    chrome: {
      path: chromePath.value,
      reachable: false,
    },
    extension: {
      connected: extensionConnected,
      last_seen_at: context.extension?.lastSeenAt,
    },
    cdp: {
      connected: cdpConnected,
    },
    artifacts: sessionId
      ? {
          root_dir: getArtifactRootDir(sessionId),
        }
      : undefined,
    notes: ["Diagnostics include runtime status; some checks may be stubbed."],
  };

  if (!chromePath.configured) {
    report.warnings = ["Chrome path is not configured."];
  }

  return report;
};
