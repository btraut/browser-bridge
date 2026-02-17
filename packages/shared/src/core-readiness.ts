import { setTimeout as delay } from 'node:timers/promises';
import { type JsonlLogger, createJsonlLogger } from './logging';
import { type ResolvedCoreRuntime, resolveCoreRuntime } from './runtime-config';

type FetchLike = typeof fetch;

export type CoreReadinessOptions = {
  host?: string;
  port?: number | string;
  cwd?: string;
  timeoutMs?: number;
  ensureDaemon?: boolean;
  strictEnvPort?: boolean;
  fetchImpl?: FetchLike;
  logger?: JsonlLogger;
  logPrefix?: string;
  healthRetryMs?: number;
  healthAttempts?: number;
  spawnDaemon?: (runtime: ResolvedCoreRuntime) => void;
};

export type CoreReadinessController = {
  readonly baseUrl: string;
  readonly runtime: ResolvedCoreRuntime;
  refreshRuntime: () => void;
  ensureReady: () => Promise<void>;
  checkHealth: () => Promise<boolean>;
};

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_HEALTH_RETRY_MS = 250;
const DEFAULT_HEALTH_ATTEMPTS = 20;

const resolveTimeoutMs = (timeoutMs?: number): number => {
  const candidate =
    timeoutMs ??
    (process.env.BROWSER_BRIDGE_CORE_TIMEOUT_MS
      ? Number.parseInt(process.env.BROWSER_BRIDGE_CORE_TIMEOUT_MS, 10)
      : process.env.BROWSER_VISION_CORE_TIMEOUT_MS
        ? Number.parseInt(process.env.BROWSER_VISION_CORE_TIMEOUT_MS, 10)
        : undefined);

  if (candidate === undefined || candidate === null) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid timeoutMs: ${String(candidate)}`);
  }

  return Math.floor(parsed);
};

const hasExplicitRuntimeInput = (
  options: Pick<CoreReadinessOptions, 'host' | 'port'>
): boolean =>
  options.host !== undefined ||
  options.port !== undefined ||
  process.env.BROWSER_BRIDGE_CORE_HOST !== undefined ||
  process.env.BROWSER_VISION_CORE_HOST !== undefined ||
  process.env.BROWSER_BRIDGE_CORE_PORT !== undefined ||
  process.env.BROWSER_VISION_CORE_PORT !== undefined;

export const createCoreReadinessController = (
  options: CoreReadinessOptions = {}
): CoreReadinessController => {
  const logger =
    options.logger ??
    createJsonlLogger({
      stream: 'cli',
      cwd: options.cwd,
    }).child({ scope: 'core-readiness' });

  const logPrefix = options.logPrefix ?? 'core';
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const ensureDaemon = options.ensureDaemon ?? true;
  const healthRetryMs = options.healthRetryMs ?? DEFAULT_HEALTH_RETRY_MS;
  const healthAttempts = options.healthAttempts ?? DEFAULT_HEALTH_ATTEMPTS;

  let runtime = resolveCoreRuntime({
    host: options.host,
    port: options.port,
    cwd: options.cwd,
    strictEnvPort: options.strictEnvPort ?? true,
  });
  let baseUrl = `http://${runtime.host}:${runtime.port}`;

  const allowRuntimeRefresh = !hasExplicitRuntimeInput(options);

  const refreshRuntime = (): void => {
    if (!allowRuntimeRefresh) {
      return;
    }
    runtime = resolveCoreRuntime({
      cwd: options.cwd,
      strictEnvPort: options.strictEnvPort ?? true,
    });
    baseUrl = `http://${runtime.host}:${runtime.port}`;
  };

  const checkHealth = async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/health`, {
            method: 'GET',
            signal: controller.signal,
          });
        } catch (error) {
          if (
            controller.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            logger.warn(`${logPrefix}.health.timeout`, {
              base_url: baseUrl,
              timeout_ms: timeoutMs,
            });
            return false;
          }
          logger.warn(`${logPrefix}.health.fetch_failed`, {
            base_url: baseUrl,
            error,
          });
          throw error;
        }
        if (!response.ok) {
          logger.warn(`${logPrefix}.health.non_ok`, {
            base_url: baseUrl,
            status: response.status,
          });
          return false;
        }
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
        } | null;
        const ok = Boolean(data?.ok);
        if (!ok) {
          logger.warn(`${logPrefix}.health.not_ready`, {
            base_url: baseUrl,
          });
        }
        return ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      logger.warn(`${logPrefix}.health.error`, {
        base_url: baseUrl,
        error,
      });
      return false;
    }
  };

  const ensureCoreRunning = async (): Promise<void> => {
    refreshRuntime();
    if (await checkHealth()) {
      logger.debug(`${logPrefix}.ensure_ready.already_running`, {
        base_url: baseUrl,
      });
      return;
    }

    if (!options.spawnDaemon) {
      logger.error(`${logPrefix}.ensure_ready.missing_spawn`, {
        host: runtime.host,
        port: runtime.port,
      });
      throw new Error(
        `Core daemon is not running on ${runtime.host}:${runtime.port} and spawnDaemon is not configured.`
      );
    }
    options.spawnDaemon(runtime);

    for (let attempt = 0; attempt < healthAttempts; attempt += 1) {
      await delay(healthRetryMs);
      refreshRuntime();
      if (await checkHealth()) {
        logger.info(`${logPrefix}.ensure_ready.ready`, {
          base_url: baseUrl,
          attempts: attempt + 1,
        });
        return;
      }
    }

    logger.error(`${logPrefix}.ensure_ready.failed`, {
      host: runtime.host,
      port: runtime.port,
      attempts: healthAttempts,
    });
    throw new Error(
      `Core daemon failed to start on ${runtime.host}:${runtime.port}.`
    );
  };

  let ensurePromise: Promise<void> | null = null;
  const ensureReady = async (): Promise<void> => {
    if (!ensureDaemon) {
      return;
    }
    if (!ensurePromise) {
      ensurePromise = ensureCoreRunning();
    }
    await ensurePromise;
  };

  return {
    get baseUrl() {
      return baseUrl;
    },
    get runtime() {
      return runtime;
    },
    refreshRuntime,
    ensureReady,
    checkHealth,
  };
};
