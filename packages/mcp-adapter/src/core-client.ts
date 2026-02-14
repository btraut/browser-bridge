import {
  ApiEnvelope,
  JsonlLogger,
  createJsonlLogger,
  resolveCoreRuntime,
} from '@btraut/browser-bridge-shared';

type FetchLike = typeof fetch;

export type CoreClientOptions = {
  host?: string;
  port?: number | string;
  cwd?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: JsonlLogger;
};

export type CoreClient = {
  baseUrl: string;
  post: <T>(path: string, body?: unknown) => Promise<ApiEnvelope<T>>;
};

// Must be long enough to accommodate user-approval prompts in the extension.
const DEFAULT_TIMEOUT_MS = 30000;

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
      stream: 'mcp-adapter',
      cwd: options.cwd,
    }).child({ scope: 'core-client' });

  const runtime = resolveCoreRuntime({
    host: options.host,
    port: options.port,
    cwd: options.cwd,
    strictEnvPort: true,
  });
  const host = runtime.host;
  const port = runtime.port;
  const baseUrl = `http://${host}:${port}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const requestJson = async <T>(path: string, body?: unknown): Promise<T> => {
    const requestPath = normalizePath(path);
    const startedAt = process.hrtime.bigint();
    logger.debug('mcp.core.request.start', {
      path: requestPath,
      base_url: baseUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${requestPath}`, {
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
          base_url: baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
        });
        throw new Error(`Empty response from Core (${response.status}).`);
      }

      try {
        const parsed = JSON.parse(raw) as T;
        logger.debug('mcp.core.request.end', {
          path: requestPath,
          base_url: baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
        });
        return parsed;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown JSON parse error';
        logger.error('mcp.core.request.invalid_json', {
          path: requestPath,
          base_url: baseUrl,
          status: response.status,
          duration_ms: durationMs(startedAt),
          error,
        });
        throw new Error(`Failed to parse Core response: ${message}`);
      }
    } catch (error) {
      logger.error('mcp.core.request.failed', {
        path: requestPath,
        base_url: baseUrl,
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
    return requestJson<ApiEnvelope<T>>(path, body);
  };

  return { baseUrl, post };
};
