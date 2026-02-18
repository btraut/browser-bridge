import { getArtifactRootDir } from './artifacts';
import type { RecoveryAttempt, RecoveryMetrics } from './recovery';

export type DiagnosticCheck = {
  name: string;
  ok: boolean;
  message?: string;
  details?: Record<string, unknown>;
};

type RuntimeEndpointContext = {
  host?: string;
  port?: number;
  baseUrl?: string;
  hostSource?: string;
  portSource?: string;
  metadataPath?: string;
  isolatedMode?: boolean;
};

type RuntimeProcessContext = {
  component?: 'cli' | 'mcp' | 'core';
  version?: string;
  pid?: number;
  nodeVersion?: string;
  binaryPath?: string;
  argvEntry?: string;
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
  runtime?: {
    caller?: {
      endpoint?: {
        host?: string;
        port?: number;
        base_url?: string;
        host_source?: string;
        port_source?: string;
        metadata_path?: string;
        isolated_mode?: boolean;
      };
      process?: {
        component?: 'cli' | 'mcp' | 'core';
        version?: string;
        pid?: number;
        node_version?: string;
        binary_path?: string;
        argv_entry?: string;
      };
    };
    core?: {
      endpoint?: {
        host?: string;
        port?: number;
        base_url?: string;
        host_source?: string;
        port_source?: string;
        metadata_path?: string;
        isolated_mode?: boolean;
      };
      process?: {
        component?: 'cli' | 'mcp' | 'core';
        version?: string;
        pid?: number;
        node_version?: string;
        binary_path?: string;
        argv_entry?: string;
      };
    };
    extension?: {
      version?: string;
      protocol_version?: string;
      capability_negotiated?: boolean;
      capabilities?: Record<string, boolean>;
      endpoint?: {
        host?: string;
        port?: number;
        base_url?: string;
        host_source?: string;
        port_source?: string;
        metadata_path?: string;
        isolated_mode?: boolean;
      };
      port_source?: 'default' | 'storage';
    };
  };
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
    version?: string;
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
  runtime?: {
    caller?: {
      endpoint?: RuntimeEndpointContext;
      process?: RuntimeProcessContext;
    };
    core?: {
      endpoint?: RuntimeEndpointContext;
      process?: RuntimeProcessContext;
    };
    extension?: {
      version?: string;
      protocolVersion?: string;
      capabilityNegotiated?: boolean;
      capabilities?: Record<string, boolean>;
      endpoint?: RuntimeEndpointContext;
      portSource?: 'default' | 'storage';
    };
  };
};

const STALE_ERROR_THRESHOLD_MS = 2 * 60 * 1000;

const getErrorAgeMs = (timestamp: string): number | undefined => {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Date.now() - parsed);
};

const endpointLabel = (endpoint?: RuntimeEndpointContext): string => {
  if (!endpoint) {
    return 'unknown';
  }
  if (endpoint.baseUrl) {
    return endpoint.baseUrl;
  }
  if (endpoint.host && endpoint.port !== undefined) {
    return `${endpoint.host}:${endpoint.port}`;
  }
  return 'unknown';
};

const hasEndpoint = (
  endpoint?: RuntimeEndpointContext
): endpoint is RuntimeEndpointContext & {
  host: string;
  port: number;
} =>
  Boolean(
    endpoint &&
    typeof endpoint.host === 'string' &&
    endpoint.host.length > 0 &&
    typeof endpoint.port === 'number' &&
    Number.isFinite(endpoint.port)
  );

const toRuntimeEndpoint = (
  endpoint?: RuntimeEndpointContext
):
  | {
      host?: string;
      port?: number;
      base_url?: string;
      host_source?: string;
      port_source?: string;
      metadata_path?: string;
      isolated_mode?: boolean;
    }
  | undefined => {
  if (!endpoint) {
    return undefined;
  }
  return {
    host: endpoint.host,
    port: endpoint.port,
    base_url: endpoint.baseUrl,
    host_source: endpoint.hostSource,
    port_source: endpoint.portSource,
    metadata_path: endpoint.metadataPath,
    isolated_mode: endpoint.isolatedMode,
  };
};

const toRuntimeProcess = (
  process: RuntimeProcessContext | undefined
):
  | {
      component?: 'cli' | 'mcp' | 'core';
      version?: string;
      pid?: number;
      node_version?: string;
      binary_path?: string;
      argv_entry?: string;
    }
  | undefined => {
  if (!process) {
    return undefined;
  }
  return {
    component: process.component,
    version: process.version,
    pid: process.pid,
    node_version: process.nodeVersion,
    binary_path: process.binaryPath,
    argv_entry: process.argvEntry,
  };
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

  const coreEndpoint = context.runtime?.core?.endpoint;
  const callerEndpoint = context.runtime?.caller?.endpoint;
  const extensionEndpoint = context.runtime?.extension?.endpoint;

  if (hasEndpoint(coreEndpoint) && hasEndpoint(callerEndpoint)) {
    const matches =
      coreEndpoint.host === callerEndpoint.host &&
      coreEndpoint.port === callerEndpoint.port;
    checks.push({
      name: 'runtime.caller.endpoint_match',
      ok: matches,
      message: matches
        ? `Caller endpoint matches core (${endpointLabel(coreEndpoint)}).`
        : `Caller endpoint ${endpointLabel(
            callerEndpoint
          )} differs from core ${endpointLabel(coreEndpoint)}.`,
      details: {
        caller_endpoint: endpointLabel(callerEndpoint),
        core_endpoint: endpointLabel(coreEndpoint),
        caller_host_source: callerEndpoint.hostSource,
        caller_port_source: callerEndpoint.portSource,
        core_host_source: coreEndpoint.hostSource,
        core_port_source: coreEndpoint.portSource,
      },
    });
  }

  if (
    extensionConnected &&
    hasEndpoint(coreEndpoint) &&
    hasEndpoint(extensionEndpoint)
  ) {
    const matches =
      coreEndpoint.host === extensionEndpoint.host &&
      coreEndpoint.port === extensionEndpoint.port;
    checks.push({
      name: 'runtime.extension.endpoint_match',
      ok: matches,
      message: matches
        ? `Extension endpoint matches core (${endpointLabel(coreEndpoint)}).`
        : `Extension endpoint ${endpointLabel(
            extensionEndpoint
          )} differs from core ${endpointLabel(coreEndpoint)}.`,
      details: {
        extension_endpoint: endpointLabel(extensionEndpoint),
        core_endpoint: endpointLabel(coreEndpoint),
        extension_port_source: context.runtime?.extension?.portSource,
        core_host_source: coreEndpoint.hostSource,
        core_port_source: coreEndpoint.portSource,
      },
    });
  }

  const callerVersion = context.runtime?.caller?.process?.version;
  const extensionVersion = extensionConnected
    ? context.runtime?.extension?.version
    : undefined;
  if (callerVersion && extensionVersion) {
    checks.push({
      name: 'runtime.extension.version_match_caller',
      ok: callerVersion === extensionVersion,
      message:
        callerVersion === extensionVersion
          ? `Caller and extension versions match (${callerVersion}).`
          : `Caller version ${callerVersion} differs from extension version ${extensionVersion}.`,
      details: {
        caller_version: callerVersion,
        extension_version: extensionVersion,
      },
    });
  }

  if (context.driveLastError) {
    const ageMs = getErrorAgeMs(context.driveLastError.at);
    const isStale = ageMs !== undefined && ageMs > STALE_ERROR_THRESHOLD_MS;
    if (isStale) {
      warnings.push(
        `Ignoring stale drive error (${Math.round(ageMs / 1000)}s old): ${
          context.driveLastError.message
        }`
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
        `Ignoring stale inspect error (${Math.round(ageMs / 1000)}s old): ${
          context.inspectLastError.message
        }`
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
      version: context.extension?.version,
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
    runtime: context.runtime
      ? {
          caller: context.runtime.caller
            ? {
                endpoint: toRuntimeEndpoint(context.runtime.caller.endpoint),
                process: toRuntimeProcess(context.runtime.caller.process),
              }
            : undefined,
          core: context.runtime.core
            ? {
                endpoint: toRuntimeEndpoint(context.runtime.core.endpoint),
                process: toRuntimeProcess(context.runtime.core.process),
              }
            : undefined,
          extension: context.runtime.extension
            ? {
                version: context.runtime.extension.version,
                protocol_version: context.runtime.extension.protocolVersion,
                capability_negotiated:
                  context.runtime.extension.capabilityNegotiated,
                capabilities: context.runtime.extension.capabilities,
                endpoint: toRuntimeEndpoint(context.runtime.extension.endpoint),
                port_source: context.runtime.extension.portSource,
              }
            : undefined,
        }
      : undefined,
  };

  return report;
};
