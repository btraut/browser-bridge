import { DiagnosticsContext, buildDiagnosticReport } from '../diagnostics';
import type { SessionRegistry } from '../session';
import type { ExtensionBridge } from '../extension-bridge';
import type { DriveController } from '../drive';
import type { InspectService } from '../inspect';
import type { DebuggerBridge } from '../debugger-bridge';
import type { RecoveryTracker } from '../recovery';
import {
  DiagnosticsDoctorInputSchema,
  HealthCheckInputSchema,
  type ResolvedCoreRuntime,
} from '@btraut/browser-bridge-shared';
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
  coreRuntime?: ResolvedCoreRuntime;
  coreVersion?: string;
};

const PROCESS_STARTED_AT = new Date(
  Date.now() - Math.floor(process.uptime() * 1000)
).toISOString();

export const registerDiagnosticsRoutes = (
  router: RouteRegistry,
  options: DiagnosticsRoutesOptions = {}
): void => {
  const handleHealthCheck = (req: RequestLike, res: ResponseLike): void => {
    const body = req.body ?? {};
    if (!isRecord(body)) {
      sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'Request body must be an object.',
        retryable: false,
      });
      return;
    }

    const parsed = HealthCheckInputSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: issue?.message ?? 'Invalid health check request.',
        retryable: false,
        details: issue?.path.length
          ? { field: issue.path.map((part) => String(part)).join('.') }
          : undefined,
      });
      return;
    }

    const sessionsActive = options.registry
      ? options.registry.list().length
      : 0;
    const extensionStatus = options.extensionBridge?.getStatus();

    sendResult(res, {
      started_at: PROCESS_STARTED_AT,
      uptime_ms: Math.floor(process.uptime() * 1000),
      memory: process.memoryUsage(),
      sessions: { active: sessionsActive },
      extension: {
        connected: extensionStatus?.connected ?? false,
        ...(extensionStatus?.extensionId
          ? { extension_id: extensionStatus.extensionId }
          : {}),
        ...(extensionStatus?.lastSeenAt
          ? { last_seen_at: extensionStatus.lastSeenAt }
          : {}),
      },
    });
  };

  router.post('/health/check', handleHealthCheck);
  // Legacy compatibility route.
  router.post('/health_check', handleHealthCheck);

  router.post('/diagnostics/doctor', (req, res) => {
    const body = req.body ?? {};
    if (!isRecord(body)) {
      sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'Request body must be an object.',
        retryable: false,
      });
      return;
    }
    const parsedDoctorInput = DiagnosticsDoctorInputSchema.safeParse(body);
    if (!parsedDoctorInput.success) {
      const issue = parsedDoctorInput.error.issues[0];
      sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: issue?.message ?? 'Invalid diagnostics doctor request.',
        retryable: false,
        details: issue?.path.length
          ? { field: issue.path.map((part) => String(part)).join('.') }
          : undefined,
      });
      return;
    }
    const sessionId = parsedDoctorInput.data.session_id;

    try {
      const context: DiagnosticsContext = {};
      context.runtime = {
        caller: parsedDoctorInput.data.caller
          ? {
              endpoint: parsedDoctorInput.data.caller.endpoint
                ? {
                    host: parsedDoctorInput.data.caller.endpoint.host,
                    port: parsedDoctorInput.data.caller.endpoint.port,
                    baseUrl: parsedDoctorInput.data.caller.endpoint.base_url,
                    hostSource:
                      parsedDoctorInput.data.caller.endpoint.host_source,
                    portSource:
                      parsedDoctorInput.data.caller.endpoint.port_source,
                    metadataPath:
                      parsedDoctorInput.data.caller.endpoint.metadata_path,
                    isolatedMode:
                      parsedDoctorInput.data.caller.endpoint.isolated_mode,
                  }
                : undefined,
              process: parsedDoctorInput.data.caller.process
                ? {
                    component: parsedDoctorInput.data.caller.process.component,
                    version: parsedDoctorInput.data.caller.process.version,
                    pid: parsedDoctorInput.data.caller.process.pid,
                    nodeVersion:
                      parsedDoctorInput.data.caller.process.node_version,
                    binaryPath:
                      parsedDoctorInput.data.caller.process.binary_path,
                    argvEntry: parsedDoctorInput.data.caller.process.argv_entry,
                  }
                : undefined,
            }
          : undefined,
        core: {
          endpoint: options.coreRuntime
            ? {
                host: options.coreRuntime.host,
                port: options.coreRuntime.port,
                baseUrl: `http://${options.coreRuntime.host}:${options.coreRuntime.port}`,
                hostSource: options.coreRuntime.hostSource,
                portSource: options.coreRuntime.portSource,
                metadataPath: options.coreRuntime.metadataPath,
                isolatedMode: options.coreRuntime.isolatedMode,
              }
            : undefined,
          process: {
            component: 'core',
            version: options.coreVersion,
            pid: process.pid,
            nodeVersion: process.version,
            binaryPath: process.execPath,
            argvEntry: process.argv[1],
          },
        },
      };
      if (options.registry && sessionId) {
        try {
          const session = options.registry.require(sessionId);
          context.sessionState = session.state;
        } catch {
          // Ignore missing session for diagnostics.
        }
      }

      if (options.registry) {
        const now = Date.now();
        const sessions = options.registry.list();
        let maxAgeMs = 0;
        let maxIdleMs = 0;
        for (const session of sessions) {
          const ageMs = now - session.createdAt.getTime();
          const idleMs = now - session.lastAccessedAt.getTime();
          if (ageMs > maxAgeMs) {
            maxAgeMs = ageMs;
          }
          if (idleMs > maxIdleMs) {
            maxIdleMs = idleMs;
          }
        }
        context.sessions = {
          count: sessions.length,
          ...(sessions.length > 0 ? { maxAgeMs, maxIdleMs } : {}),
        };
      }

      if (options.extensionBridge) {
        const status = options.extensionBridge.getStatus();
        context.extension = {
          connected: status.connected,
          extensionId: status.extensionId,
          version: status.version,
          lastSeenAt: status.lastSeenAt,
        };
        if (status.connected) {
          context.runtime.extension = {
            extensionId: status.extensionId,
            version: status.version,
            protocolVersion: status.protocolVersion,
            capabilityNegotiated: status.capabilityNegotiated,
            capabilities: status.capabilities,
            endpoint:
              status.coreHost && typeof status.corePort === 'number'
                ? {
                    host: status.coreHost,
                    port: status.corePort,
                    baseUrl: `http://${status.coreHost}:${status.corePort}`,
                  }
                : undefined,
            portSource: status.corePortSource,
          };
        }
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
