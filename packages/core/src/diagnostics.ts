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
  sessionId?: string
): DiagnosticReport => {
  const chromePath = resolveChromePath();
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
      ok: false,
      message: "Extension is not connected.",
    },
    {
      name: "cdp.connected",
      ok: false,
      message: "CDP is not connected.",
    },
    {
      name: "session.state",
      ok: false,
      message: sessionId
        ? "Session state unavailable (stub)."
        : "Session id not provided.",
      details: {
        session_id: sessionId || null,
        state: "UNKNOWN",
      },
    },
  ];

  const report: DiagnosticReport = {
    ok: checks.every((check) => check.ok),
    session_id: sessionId,
    checks,
    chrome: {
      path: chromePath.value,
      reachable: false,
    },
    extension: {
      connected: false,
    },
    cdp: {
      connected: false,
    },
    artifacts: sessionId
      ? {
          root_dir: getArtifactRootDir(sessionId),
        }
      : undefined,
    notes: ["Diagnostics are currently stubbed."],
  };

  if (!chromePath.configured) {
    report.warnings = ["Chrome path is not configured."];
  }

  return report;
};
