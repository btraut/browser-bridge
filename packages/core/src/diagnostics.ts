import { getArtifactRootDir } from './artifacts';
import type { RecoveryAttempt, RecoveryMetrics } from './recovery';

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
  sessions?: {
    count?: number;
    max_age_ms?: number;
    max_idle_ms?: number;
  };
  extension?: {
    connected?: boolean;
    version?: string;
    last_seen_at?: string;
  };
  debugger?: {
    attached?: boolean;
    idle_timeout_ms?: number;
    console_buffer_size?: number;
    network_buffer_size?: number;
    last_error?: {
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };
  };
  artifacts?: {
    root_dir?: string;
  };
  recovery?: {
    last_attempt?: {
      session_id: string;
      recovered: boolean;
      state: string;
      message?: string;
      at: string;
    };
    attempts?: {
      session_id: string;
      recovered: boolean;
      state: string;
      message?: string;
      at: string;
    }[];
    success_count?: number;
    failure_count?: number;
    success_rate?: number;
    recent_failure_count?: number;
    loop_detected?: boolean;
  };
  warnings?: string[];
  notes?: string[];
};

export type DiagnosticsContext = {
  sessionState?: string;
  sessions?: {
    count: number;
    maxAgeMs?: number;
    maxIdleMs?: number;
  };
  extension?: {
    connected: boolean;
    lastSeenAt?: string;
  };
  debugger?: {
    attached: boolean;
    idle_timeout_ms: number;
    console_buffer_size: number;
    network_buffer_size: number;
    last_error?: {
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };
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
  recoveryAttempt?: RecoveryAttempt;
  recoveryMetrics?: RecoveryMetrics;
};

const STALE_ERROR_THRESHOLD_MS = 2 * 60 * 1000;

const getErrorAgeMs = (timestamp: string): number | undefined => {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Date.now() - parsed);
};

export const buildDiagnosticReport = (
  sessionId?: string,
  context: DiagnosticsContext = {}
): DiagnosticReport => {
  const extensionConnected = context.extension?.connected ?? false;
  const debuggerAttached = context.debugger?.attached ?? false;
  const sessionState = context.sessionState;
  const hasSessionId = Boolean(sessionId);
  const warnings: string[] = [];

  const checks: DiagnosticCheck[] = [
    {
      name: 'extension.connected',
      ok: extensionConnected,
      message: extensionConnected
        ? 'Extension is connected.'
        : 'Extension is not connected.',
    },
    {
      name: 'debugger.attached',
      ok: true,
      message: debuggerAttached
        ? 'Debugger is attached.'
        : 'Debugger is not attached (inspect is idle).',
    },
    {
      name: 'session.state',
      ok: hasSessionId ? Boolean(sessionState) : true,
      message: sessionState
        ? `Session state is ${sessionState}.`
        : hasSessionId
          ? 'Session state unavailable.'
          : 'Session id not provided.',
      details: {
        session_id: sessionId || null,
        state: sessionState ?? 'UNKNOWN',
      },
    },
  ];

  if (context.driveLastError) {
    const ageMs = getErrorAgeMs(context.driveLastError.at);
    const isStale = ageMs !== undefined && ageMs > STALE_ERROR_THRESHOLD_MS;
    if (isStale) {
      warnings.push(
        `Ignoring stale drive error (${Math.round(ageMs / 1000)}s old): ${context.driveLastError.message}`
      );
    }
    checks.push({
      name: 'drive.last_error',
      ok: isStale,
      message: context.driveLastError.message,
      details: {
        code: context.driveLastError.code,
        retryable: context.driveLastError.retryable,
        at: context.driveLastError.at,
        ...(ageMs !== undefined ? { age_ms: ageMs } : {}),
      },
    });
  }

  if (context.inspectLastError) {
    const ageMs = getErrorAgeMs(context.inspectLastError.at);
    const isStale = ageMs !== undefined && ageMs > STALE_ERROR_THRESHOLD_MS;
    if (isStale) {
      warnings.push(
        `Ignoring stale inspect error (${Math.round(ageMs / 1000)}s old): ${context.inspectLastError.message}`
      );
    }
    checks.push({
      name: 'inspect.last_error',
      ok: isStale,
      message: context.inspectLastError.message,
      details: {
        code: context.inspectLastError.code,
        retryable: context.inspectLastError.retryable,
        at: context.inspectLastError.at,
        ...(ageMs !== undefined ? { age_ms: ageMs } : {}),
      },
    });
  }

  if (context.recoveryAttempt) {
    checks.push({
      name: 'recovery.last_attempt',
      ok: context.recoveryAttempt.recovered,
      message: context.recoveryAttempt.message ?? 'Recovery attempt recorded.',
      details: {
        session_id: context.recoveryAttempt.sessionId,
        state: context.recoveryAttempt.state,
        at: context.recoveryAttempt.at,
      },
    });
  }

  const formatRecoveryAttempt = (attempt: RecoveryAttempt) => ({
    session_id: attempt.sessionId,
    recovered: attempt.recovered,
    state: attempt.state,
    message: attempt.message,
    at: attempt.at,
  });
  const recoveryAttempts = context.recoveryMetrics?.attempts;
  const lastRecoveryAttempt =
    context.recoveryAttempt ??
    (recoveryAttempts && recoveryAttempts[recoveryAttempts.length - 1]);

  const report: DiagnosticReport = {
    ok: checks.every((check) => check.ok),
    session_id: sessionId,
    checks,
    sessions: context.sessions
      ? {
          count: context.sessions.count,
          max_age_ms: context.sessions.maxAgeMs,
          max_idle_ms: context.sessions.maxIdleMs,
        }
      : undefined,
    extension: {
      connected: extensionConnected,
      last_seen_at: context.extension?.lastSeenAt,
    },
    debugger: context.debugger
      ? {
          attached: debuggerAttached,
          idle_timeout_ms: context.debugger.idle_timeout_ms,
          console_buffer_size: context.debugger.console_buffer_size,
          network_buffer_size: context.debugger.network_buffer_size,
          last_error: context.debugger.last_error,
        }
      : undefined,
    artifacts: sessionId
      ? {
          root_dir: getArtifactRootDir(sessionId),
        }
      : undefined,
    recovery:
      context.recoveryMetrics || lastRecoveryAttempt
        ? {
            ...(lastRecoveryAttempt
              ? { last_attempt: formatRecoveryAttempt(lastRecoveryAttempt) }
              : {}),
            ...(recoveryAttempts
              ? { attempts: recoveryAttempts.map(formatRecoveryAttempt) }
              : {}),
            ...(context.recoveryMetrics
              ? {
                  success_count: context.recoveryMetrics.successCount,
                  failure_count: context.recoveryMetrics.failureCount,
                  success_rate: context.recoveryMetrics.successRate,
                  recent_failure_count:
                    context.recoveryMetrics.recentFailureCount,
                  loop_detected: context.recoveryMetrics.loopDetected,
                }
              : {}),
          }
        : undefined,
    ...(warnings.length > 0 ? { warnings } : {}),
    notes: ['Diagnostics include runtime status; some checks may be stubbed.'],
  };

  return report;
};
