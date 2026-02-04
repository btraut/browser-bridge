import { ApiEnvelope } from '@browser-vision/shared';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

type FetchLike = typeof fetch;

type SpawnLike = typeof spawn;

export type CoreClientOptions = {
  host?: string;
  port?: number | string;
  ensureDaemon?: boolean;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  spawnImpl?: SpawnLike;
};

export type CoreClient = {
  baseUrl: string;
  ensureReady: () => Promise<void>;
  post: <T>(path: string, body?: unknown) => Promise<ApiEnvelope<T>>;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3210;
const DEFAULT_TIMEOUT_MS = 4000;
const HEALTH_RETRY_MS = 250;
const HEALTH_ATTEMPTS = 20;

const resolveHost = (host?: string): string => {
  const candidate = host?.trim() || process.env.BROWSER_VISION_CORE_HOST;
  if (candidate && candidate.length > 0) {
    return candidate;
  }
  return DEFAULT_HOST;
};

const resolvePort = (port?: number | string): number => {
  const candidate =
    port ??
    (process.env.BROWSER_VISION_CORE_PORT
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
  const spawnImpl = options.spawnImpl ?? spawn;
  const ensureDaemon = options.ensureDaemon ?? true;

  const requestJson = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${normalizePath(path)}`, {
        method,
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

  const checkHealth = async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) {
          return false;
        }
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
        } | null;
        return Boolean(data?.ok);
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  };

  const spawnDaemon = (): void => {
    const script = `const { startCoreServer } = require('@browser-vision/core');\nstartCoreServer({ host: ${JSON.stringify(
      host
    )}, port: ${port} })\n  .catch((err) => { console.error(err); process.exit(1); });`;

    const child = spawnImpl(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        BROWSER_VISION_CORE_HOST: host,
        BROWSER_VISION_CORE_PORT: String(port),
      },
    });

    child.unref();
  };

  const ensureCoreRunning = async (): Promise<void> => {
    if (await checkHealth()) {
      return;
    }

    spawnDaemon();

    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
      await delay(HEALTH_RETRY_MS);
      if (await checkHealth()) {
        return;
      }
    }

    throw new Error(`Core daemon failed to start on ${host}:${port}.`);
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
    return requestJson<ApiEnvelope<T>>('POST', path, body);
  };

  return { baseUrl, ensureReady, post };
};
