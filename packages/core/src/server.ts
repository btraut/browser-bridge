import { createServer } from 'http';
import express, { Express } from 'express';
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

const resolveCorePort = (portOverride?: number): number => {
  if (portOverride !== undefined) {
    return portOverride;
  }
  const env =
    process.env.BROWSER_BRIDGE_CORE_PORT ||
    process.env.BROWSER_VISION_CORE_PORT;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 3210;
};

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

export const startCoreServer = (
  options: CoreServerStartOptions = {}
): Promise<CoreServerHandle> => {
  const host = options.host ?? '127.0.0.1';
  const port = resolveCorePort(options.port);
  const { app, registry, extensionBridge } = createCoreServer({
    registry: options.registry,
  });

  return new Promise((resolve, reject) => {
    const server = createServer(app);
    extensionBridge.attach(server);
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort =
        typeof address === 'object' && address !== null ? address.port : port;

      const ttlMs = resolveSessionTtlMs();
      if (ttlMs > 0) {
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
      }

      resolve({ app, registry, server, host, port: resolvedPort });
    });

    server.on('error', (error) => {
      reject(error);
    });
  });
};
