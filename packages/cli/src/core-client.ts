import {
  ApiEnvelope,
  ErrorInfo,
  JsonlLogger,
  createJsonlLogger,
  resolveCoreRuntime,
} from '@btraut/browser-bridge-shared';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type FetchLike = typeof fetch;

type SpawnLike = typeof spawn;

export class CoreClientError extends Error {
  readonly info: ErrorInfo;

  constructor(info: ErrorInfo) {
    super(info.message);
    this.name = 'CoreClientError';
    this.info = info;
  }
}

export type CoreClientOptions = {
  host?: string;
  port?: number | string;
  cwd?: string;
  ensureDaemon?: boolean;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  spawnImpl?: SpawnLike;
  logger?: JsonlLogger;
};

export type CoreClient = {
  baseUrl: string;
  ensureReady: () => Promise<void>;
  post: <T>(path: string, body?: unknown) => Promise<ApiEnvelope<T>>;
};

// Must be long enough to accommodate user-approval prompts in the extension.
const DEFAULT_TIMEOUT_MS = 30000;
const HEALTH_RETRY_MS = 250;
const HEALTH_ATTEMPTS = 20;

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

const normalizePath = (path: string): string =>
  path.startsWith('/') ? path : `/${path}`;

const durationMs = (startedAt: bigint): number =>
  Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));

export const createCoreClient = (
  options: CoreClientOptions = {}
): CoreClient => {
  const logger =
    options.logger ??
    createJsonlLogger({
      stream: 'cli',
      cwd: options.cwd,
    }).child({ scope: 'core-client' });

  let runtime = resolveCoreRuntime({
    host: options.host,
    port: options.port,
    cwd: options.cwd,
    strictEnvPort: true,
  });
  let baseUrl = `http://${runtime.host}:${runtime.port}`;
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? spawn;
  const ensureDaemon = options.ensureDaemon ?? true;
  const allowRuntimeRefresh =
    options.host === undefined &&
    options.port === undefined &&
    process.env.BROWSER_BRIDGE_CORE_HOST === undefined &&
    process.env.BROWSER_VISION_CORE_HOST === undefined &&
    process.env.BROWSER_BRIDGE_CORE_PORT === undefined &&
    process.env.BROWSER_VISION_CORE_PORT === undefined;

  const refreshRuntime = (): void => {
    if (!allowRuntimeRefresh) {
      return;
    }
    runtime = resolveCoreRuntime({
      cwd: options.cwd,
      strictEnvPort: true,
    });
    baseUrl = `http://${runtime.host}:${runtime.port}`;
  };

  const requestJson = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> => {
    const requestPath = normalizePath(path);
    const startedAt = process.hrtime.bigint();
    logger.debug('cli.core.request.start', {
      method,
      path: requestPath,
      base_url: baseUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${requestPath}`, {
          method,
          headers: {
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          logger.warn('cli.core.request.timeout', {
            method,
            path: requestPath,
            base_url: baseUrl,
            timeout_ms: timeoutMs,
            duration_ms: durationMs(startedAt),
          });
          throw new CoreClientError({
            code: 'TIMEOUT',
            message: `Core request timed out after ${timeoutMs}ms.`,
            retryable: true,
            details: {
              timeout_ms: timeoutMs,
              base_url: baseUrl,
              path: requestPath,
            },
          });
        }
        logger.error('cli.core.request.failed', {
          method,
          path: requestPath,
          base_url: baseUrl,
          duration_ms: durationMs(startedAt),
          error,
        });
        throw error;
      }

      const raw = await response.text();
      if (!raw) {
        logger.warn('cli.core.request.empty_response', {
          method,
          path: requestPath,
          base_url: baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
        });
        throw new Error(`Empty response from Core (${response.status}).`);
      }

      try {
        const parsed = JSON.parse(raw) as T;
        logger.debug('cli.core.request.end', {
          method,
          path: requestPath,
          base_url: baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
        });
        return parsed;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown JSON parse error';
        logger.error('cli.core.request.invalid_json', {
          method,
          path: requestPath,
          base_url: baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
          error,
        });
        throw new Error(`Failed to parse Core response: ${message}`);
      }
    } finally {
      clearTimeout(timeout);
    }
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
            logger.warn('cli.core.health.timeout', {
              base_url: baseUrl,
              timeout_ms: timeoutMs,
            });
            return false;
          }
          logger.warn('cli.core.health.fetch_failed', {
            base_url: baseUrl,
            error,
          });
          throw error;
        }
        if (!response.ok) {
          logger.warn('cli.core.health.non_ok', {
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
          logger.warn('cli.core.health.not_ready', {
            base_url: baseUrl,
          });
        }
        return ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      logger.warn('cli.core.health.error', {
        base_url: baseUrl,
        error,
      });
      return false;
    }
  };

  const spawnDaemon = (): void => {
    const coreEntry = resolve(__dirname, 'api.js');
    const startOptions: string[] = [];
    if (runtime.hostSource === 'option' || runtime.hostSource === 'env') {
      startOptions.push(`host: ${JSON.stringify(runtime.host)}`);
    }
    if (runtime.portSource === 'option' || runtime.portSource === 'env') {
      startOptions.push(`port: ${runtime.port}`);
    }
    const script = `const { startCoreServer } = require(${JSON.stringify(
      coreEntry
    )});\nstartCoreServer({ ${startOptions.join(
      ', '
    )} })\n  .catch((err) => { console.error(err); process.exit(1); });`;

    logger.info('cli.core.spawn.start', {
      host: runtime.host,
      port: runtime.port,
      host_source: runtime.hostSource,
      port_source: runtime.portSource,
    });

    const child = spawnImpl(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });

    child.on('error', (error) => {
      logger.error('cli.core.spawn.error', {
        host: runtime.host,
        port: runtime.port,
        error,
      });
    });

    child.unref();
  };

  const ensureCoreRunning = async (): Promise<void> => {
    refreshRuntime();
    if (await checkHealth()) {
      logger.debug('cli.core.ensure_ready.already_running', {
        base_url: baseUrl,
      });
      return;
    }

    spawnDaemon();

    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
      await delay(HEALTH_RETRY_MS);
      refreshRuntime();
      if (await checkHealth()) {
        logger.info('cli.core.ensure_ready.ready', {
          base_url: baseUrl,
          attempts: attempt + 1,
        });
        return;
      }
    }

    logger.error('cli.core.ensure_ready.failed', {
      host: runtime.host,
      port: runtime.port,
      attempts: HEALTH_ATTEMPTS,
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

  const post = async <T>(
    path: string,
    body?: unknown
  ): Promise<ApiEnvelope<T>> => {
    await ensureReady();
    refreshRuntime();
    return requestJson<ApiEnvelope<T>>('POST', path, body);
  };

  return {
    get baseUrl() {
      return baseUrl;
    },
    ensureReady,
    post,
  };
};
