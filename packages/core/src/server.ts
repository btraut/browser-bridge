import { createServer } from 'http';
import express, { Express } from 'express';
import {
  createBoundedPortProbeSequence,
  resolveCoreRuntime,
  writeRuntimeMetadata,
} from '@btraut/browser-bridge-shared';
import { createSessionRouter } from './routes/session';
import { registerArtifactsRoutes } from './routes/artifacts';
import { registerDiagnosticsRoutes } from './routes/diagnostics';
import { registerDriveRoutes, registerInspectRoutes } from './routes';
import { SessionRegistry } from './session';
import { ExtensionBridge } from './extension-bridge';
import { DriveController } from './drive';
import { InspectService, createInspectService } from './inspect';
import { RecoveryTracker } from './recovery';
import { DebuggerBridge } from './debugger-bridge';

export type CoreServer = {
  app: Express;
  registry: SessionRegistry;
  extensionBridge: ExtensionBridge;
  debuggerBridge: DebuggerBridge;
  drive: DriveController;
  inspect: InspectService;
  recoveryTracker: RecoveryTracker;
};

export type CoreServerOptions = {
  registry?: SessionRegistry;
};

export const createCoreServer = (
  options: CoreServerOptions = {}
): CoreServer => {
  const app = express();
  const registry = options.registry ?? new SessionRegistry();
  const extensionBridge = new ExtensionBridge({ registry });
  const debuggerBridge = new DebuggerBridge({ extensionBridge });
  const drive = new DriveController(extensionBridge, registry);
  const inspect = createInspectService({
    registry,
    debuggerBridge,
    extensionBridge,
  });
  const recoveryTracker = new RecoveryTracker();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(
    '/session',
    createSessionRouter(registry, {
      driveConnected: () => extensionBridge.isConnected(),
      inspectRecover: (sessionId) => inspect.reconnect(sessionId),
      recordRecovery: (attempt) => recoveryTracker.record(attempt),
    })
  );

  registerDriveRoutes(app, { drive });
  registerInspectRoutes(app, {
    registry,
    extensionBridge,
    inspectService: inspect,
  });
  registerArtifactsRoutes(app, {
    registry,
    extensionBridge,
    inspectService: inspect,
  });
  registerDiagnosticsRoutes(app, {
    registry,
    extensionBridge,
    debuggerBridge,
    drive,
    inspectService: inspect,
    recoveryTracker,
  });

  return {
    app,
    registry,
    extensionBridge,
    debuggerBridge,
    drive,
    inspect,
    recoveryTracker,
  };
};

export type CoreServerStartOptions = {
  host?: string;
  port?: number;
  registry?: SessionRegistry;
};

export type CoreServerHandle = {
  app: Express;
  registry: SessionRegistry;
  server: ReturnType<typeof createServer>;
  host: string;
  port: number;
};

const CORE_PORT_PROBE_ATTEMPTS = 20;

const resolveSessionTtlMs = (): number => {
  const env =
    process.env.BROWSER_BRIDGE_SESSION_TTL_MS ||
    process.env.BROWSER_VISION_SESSION_TTL_MS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 60 * 60 * 1000;
};

const resolveSessionCleanupIntervalMs = (ttlMs: number): number => {
  const env =
    process.env.BROWSER_BRIDGE_SESSION_CLEANUP_INTERVAL_MS ||
    process.env.BROWSER_VISION_SESSION_CLEANUP_INTERVAL_MS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return 60 * 1000;
  }
  return Math.min(60 * 1000, Math.max(1000, Math.floor(ttlMs / 2)));
};

const isAddressInUseError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'EADDRINUSE'
  );

const listenOnPort = (
  app: Express,
  extensionBridge: ExtensionBridge,
  host: string,
  port: number
): Promise<ReturnType<typeof createServer>> =>
  new Promise((resolve, reject) => {
    const server = createServer(app);
    extensionBridge.attach(server);

    const onError = (error: unknown) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

const maybeStartSessionCleanup = (
  server: ReturnType<typeof createServer>,
  registry: SessionRegistry
): void => {
  const ttlMs = resolveSessionTtlMs();
  if (ttlMs <= 0) {
    return;
  }
  const intervalMs = resolveSessionCleanupIntervalMs(ttlMs);
  const timer = setInterval(() => {
    try {
      registry.cleanupIdleSessions(ttlMs);
    } catch (error) {
      console.warn('Session cleanup failed:', error);
    }
  }, intervalMs);
  timer.unref();
  server.on('close', () => clearInterval(timer));
};

export const startCoreServer = async (
  options: CoreServerStartOptions = {}
): Promise<CoreServerHandle> => {
  const runtime = resolveCoreRuntime({
    host: options.host,
    port: options.port,
    strictEnvPort: false,
  });

  const { app, registry, extensionBridge } = createCoreServer({
    registry: options.registry,
  });

  const probePorts =
    runtime.portSource === 'metadata' || runtime.portSource === 'deterministic'
      ? createBoundedPortProbeSequence(runtime.port, CORE_PORT_PROBE_ATTEMPTS)
      : [runtime.port];

  let lastAddressInUseError: unknown;
  for (const candidatePort of probePorts) {
    try {
      const server = await listenOnPort(
        app,
        extensionBridge,
        runtime.host,
        candidatePort
      );
      const address = server.address();
      const resolvedPort =
        typeof address === 'object' && address !== null
          ? address.port
          : candidatePort;

      maybeStartSessionCleanup(server, registry);

      try {
        writeRuntimeMetadata(
          {
            host: runtime.host,
            port: resolvedPort,
            git_root: runtime.gitRoot ?? undefined,
            worktree_id: runtime.worktreeId ?? undefined,
            updated_at: new Date().toISOString(),
          },
          { metadataPath: runtime.metadataPath }
        );
      } catch (error) {
        console.warn('Failed to persist runtime metadata:', error);
      }

      return {
        app,
        registry,
        server,
        host: runtime.host,
        port: resolvedPort,
      };
    } catch (error) {
      if (isAddressInUseError(error) && probePorts.length > 1) {
        lastAddressInUseError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastAddressInUseError ??
    new Error(`Unable to bind Core server on ${runtime.host}:${runtime.port}.`)
  );
};
