import { ApiEnvelope, resolveCoreRuntime } from '@btraut/browser-bridge-shared';

type FetchLike = typeof fetch;

export type CoreClientOptions = {
  host?: string;
  port?: number | string;
  cwd?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export type CoreClient = {
  baseUrl: string;
  post: <T>(path: string, body?: unknown) => Promise<ApiEnvelope<T>>;
};

// Must be long enough to accommodate user-approval prompts in the extension.
const DEFAULT_TIMEOUT_MS = 30000;

const normalizePath = (path: string): string =>
  path.startsWith('/') ? path : `/${path}`;

export const createCoreClient = (
  options: CoreClientOptions = {}
): CoreClient => {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${normalizePath(path)}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!raw) {
        throw new Error(`Empty response from Core (${response.status}).`);
      }

      try {
        return JSON.parse(raw) as T;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown JSON parse error';
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
    return requestJson<ApiEnvelope<T>>(path, body);
  };

  return { baseUrl, post };
};
