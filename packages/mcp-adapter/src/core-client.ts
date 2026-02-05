import { ApiEnvelope } from '@btraut/browser-bridge-shared';

type FetchLike = typeof fetch;

export type CoreClientOptions = {
  host?: string;
  port?: number | string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export type CoreClient = {
  baseUrl: string;
  post: <T>(path: string, body?: unknown) => Promise<ApiEnvelope<T>>;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3210;
const DEFAULT_TIMEOUT_MS = 4000;

const resolveHost = (host?: string): string => {
  const candidate =
    host?.trim() ||
    process.env.BROWSER_BRIDGE_CORE_HOST ||
    process.env.BROWSER_VISION_CORE_HOST;
  if (candidate && candidate.length > 0) {
    return candidate;
  }
  return DEFAULT_HOST;
};

const resolvePort = (port?: number | string): number => {
  const candidate =
    port ??
    (process.env.BROWSER_BRIDGE_CORE_PORT
      ? Number.parseInt(process.env.BROWSER_BRIDGE_CORE_PORT, 10)
      : process.env.BROWSER_VISION_CORE_PORT
        ? Number.parseInt(process.env.BROWSER_VISION_CORE_PORT, 10)
        : undefined);

  if (candidate === undefined || candidate === null) {
    return DEFAULT_PORT;
  }

  const parsed =
    typeof candidate === 'number' ? candidate : Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${String(candidate)}`);
  }

  return parsed;
};

const normalizePath = (path: string): string =>
  path.startsWith('/') ? path : `/${path}`;

export const createCoreClient = (
  options: CoreClientOptions = {}
): CoreClient => {
  const host = resolveHost(options.host);
  const port = resolvePort(options.port);
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
