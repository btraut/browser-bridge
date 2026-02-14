import {
  ApiEnvelope,
  ErrorInfo,
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

export const createCoreClient = (
  options: CoreClientOptions = {}
): CoreClient => {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${normalizePath(path)}`, {
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
          throw new CoreClientError({
            code: 'TIMEOUT',
            message: `Core request timed out after ${timeoutMs}ms.`,
            retryable: true,
            details: {
              timeout_ms: timeoutMs,
              base_url: baseUrl,
              path: normalizePath(path),
            },
          });
        }
        throw error;
      }

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
            return false;
          }
          throw error;
        }
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

    const child = spawnImpl(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });

    child.unref();
  };

  const ensureCoreRunning = async (): Promise<void> => {
    refreshRuntime();
    if (await checkHealth()) {
      return;
    }

    spawnDaemon();

    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
      await delay(HEALTH_RETRY_MS);
      refreshRuntime();
      if (await checkHealth()) {
        return;
      }
    }

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
