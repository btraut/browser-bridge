import {
  ApiEnvelope,
  ErrorInfo,
  JsonlLogger,
  createCoreReadinessController,
  createJsonlLogger,
} from '@btraut/browser-bridge-shared';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

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

  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? spawn;
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);

  const readiness = createCoreReadinessController({
    host: options.host,
    port: options.port,
    cwd: options.cwd,
    timeoutMs,
    ensureDaemon: options.ensureDaemon ?? true,
    strictEnvPort: true,
    fetchImpl,
    logger,
    logPrefix: 'cli.core',
    spawnDaemon: (runtime) => {
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
    },
  });

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
      base_url: readiness.baseUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${readiness.baseUrl}${requestPath}`, {
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
            base_url: readiness.baseUrl,
            timeout_ms: timeoutMs,
            duration_ms: durationMs(startedAt),
          });
          throw new CoreClientError({
            code: 'TIMEOUT',
            message: `Core request timed out after ${timeoutMs}ms.`,
            retryable: true,
            details: {
              timeout_ms: timeoutMs,
              base_url: readiness.baseUrl,
              path: requestPath,
            },
          });
        }
        logger.error('cli.core.request.failed', {
          method,
          path: requestPath,
          base_url: readiness.baseUrl,
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
          base_url: readiness.baseUrl,
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
          base_url: readiness.baseUrl,
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
          base_url: readiness.baseUrl,
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

  const post = async <T>(
    path: string,
    body?: unknown
  ): Promise<ApiEnvelope<T>> => {
    await readiness.ensureReady();
    readiness.refreshRuntime();
    return requestJson<ApiEnvelope<T>>('POST', path, body);
  };

  return {
    get baseUrl() {
      return readiness.baseUrl;
    },
    ensureReady: readiness.ensureReady,
    post,
  };
};
