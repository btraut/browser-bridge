import {
  ApiEnvelope,
  ErrorEnvelope,
  JsonlLogger,
  createCoreReadinessController,
  createJsonlLogger,
} from '@btraut/browser-bridge-shared';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

type FetchLike = typeof fetch;

type SpawnLike = typeof spawn;

export type CoreClientOptions = {
  host?: string;
  port?: number | string;
  cwd?: string;
  timeoutMs?: number;
  ensureDaemon?: boolean;
  componentVersion?: string;
  healthRetryMs?: number;
  healthAttempts?: number;
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

const normalizePath = (path: string): string =>
  path.startsWith('/') ? path : `/${path}`;

const durationMs = (startedAt: bigint): number =>
  Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));

const toReadinessErrorEnvelope = (
  error: unknown,
  baseUrl: string
): ErrorEnvelope => ({
  ok: false,
  error: {
    code: 'UNAVAILABLE',
    message:
      error instanceof Error
        ? `Core not ready at ${baseUrl}: ${error.message}`
        : `Core not ready at ${baseUrl}.`,
    retryable: true,
    details: {
      base_url: baseUrl,
    },
  },
});

export const createCoreClient = (
  options: CoreClientOptions = {}
): CoreClient => {
  const logger =
    options.logger ??
    createJsonlLogger({
      stream: 'mcp-adapter',
      cwd: options.cwd,
    }).child({ scope: 'core-client' });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? spawn;
  const ensureDaemon = options.ensureDaemon ?? false;
  const componentVersion =
    options.componentVersion ??
    process.env.BROWSER_BRIDGE_VERSION ??
    process.env.npm_package_version;

  const readiness = createCoreReadinessController({
    host: options.host,
    port: options.port,
    cwd: options.cwd,
    timeoutMs,
    ensureDaemon,
    strictEnvPort: true,
    fetchImpl,
    logger,
    logPrefix: 'mcp.core',
    healthRetryMs: options.healthRetryMs,
    healthAttempts: options.healthAttempts,
    spawnDaemon: ensureDaemon
      ? (runtime) => {
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

          logger.info('mcp.core.spawn.start', {
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
            logger.error('mcp.core.spawn.error', {
              host: runtime.host,
              port: runtime.port,
              error,
            });
          });

          child.unref();
        }
      : undefined,
  });

  const requestJson = async <T>(path: string, body?: unknown): Promise<T> => {
    const requestPath = normalizePath(path);
    const startedAt = process.hrtime.bigint();
    logger.debug('mcp.core.request.start', {
      path: requestPath,
      base_url: readiness.baseUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${readiness.baseUrl}${requestPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!raw) {
        logger.warn('mcp.core.request.empty_response', {
          path: requestPath,
          base_url: readiness.baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
        });
        throw new Error(`Empty response from Core (${response.status}).`);
      }

      try {
        const parsed = JSON.parse(raw) as T;
        logger.debug('mcp.core.request.end', {
          path: requestPath,
          base_url: readiness.baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
        });
        return parsed;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown JSON parse error';
        logger.error('mcp.core.request.invalid_json', {
          path: requestPath,
          base_url: readiness.baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
          error,
        });
        throw new Error(`Failed to parse Core response: ${message}`);
      }
    } catch (error) {
      logger.error('mcp.core.request.failed', {
        path: requestPath,
        base_url: readiness.baseUrl,
        duration_ms: durationMs(startedAt),
        error,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const post = async <T>(
    path: string,
    body?: unknown
  ): Promise<ApiEnvelope<T>> => {
    try {
      await readiness.ensureReady();
    } catch (error) {
      logger.warn('mcp.core.ensure_ready.unavailable', {
        base_url: readiness.baseUrl,
        error,
      });
      throw toReadinessErrorEnvelope(error, readiness.baseUrl);
    }
    readiness.refreshRuntime();
    const payload =
      path === '/diagnostics/doctor' &&
      (!body || (typeof body === 'object' && !Array.isArray(body)))
        ? {
            ...(body && typeof body === 'object' ? body : {}),
            caller: {
              endpoint: {
                host: readiness.runtime.host,
                port: readiness.runtime.port,
                base_url: readiness.baseUrl,
                host_source: readiness.runtime.hostSource,
                port_source: readiness.runtime.portSource,
                metadata_path: readiness.runtime.metadataPath,
                isolated_mode: readiness.runtime.isolatedMode,
              },
              process: {
                component: 'mcp' as const,
                version: componentVersion,
                pid: process.pid,
                node_version: process.version,
                binary_path: process.execPath,
                argv_entry: process.argv[1],
              },
            },
          }
        : body;
    return requestJson<ApiEnvelope<T>>(path, payload);
  };

  return {
    get baseUrl() {
      return readiness.baseUrl;
    },
    ensureReady: readiness.ensureReady,
    post,
  };
};
