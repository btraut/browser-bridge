import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HTTP_CONTRACT_VERSION,
  HTTP_CONTRACT_VERSION_HEADER,
} from '@btraut/browser-bridge-shared';
import { createCoreClient } from './core-client';

const makeResponse = (
  body: unknown,
  options: {
    ok?: boolean;
    status?: number;
    rawText?: string;
    headers?: Record<string, string>;
  } = {}
) =>
  ({
    ok: options.ok ?? true,
    status: options.status ?? ((options.ok ?? true) ? 200 : 500),
    json: async () => body,
    text: async () =>
      options.rawText !== undefined ? options.rawText : JSON.stringify(body),
    headers: {
      get: (name: string) => {
        const key = Object.keys(options.headers ?? {}).find(
          (entry) => entry.toLowerCase() === name.toLowerCase()
        );
        return key ? (options.headers?.[key] ?? null) : null;
      },
    },
  }) as unknown as Response;

const trackedTempDirs: string[] = [];

const createTempDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedTempDirs.push(dir);
  return dir;
};

const createGitRoot = (prefix: string): string => {
  const root = createTempDir(prefix);
  mkdirSync(path.join(root, '.git'), { recursive: true });
  return root;
};

const withEnv = async <T>(
  entries: Record<string, string | undefined>,
  run: () => Promise<T> | T
): Promise<T> => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(entries)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

afterEach(() => {
  while (trackedTempDirs.length > 0) {
    const dir = trackedTempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('createCoreClient', () => {
  it('posts to Core with JSON payload', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: true, result: { value: 'ok' } })
    ) as unknown as typeof fetch;

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: false,
      fetchImpl,
    });

    const result = await client.post('/session/create', { mode: 'auto' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/session/create',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [HTTP_CONTRACT_VERSION_HEADER]: HTTP_CONTRACT_VERSION,
        },
        body: JSON.stringify({ mode: 'auto' }),
      })
    );
    expect(result).toEqual({ ok: true, result: { value: 'ok' } });
  });

  it('checks health before posting when daemon is enabled', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return makeResponse({ ok: true });
      }
      return makeResponse({ ok: true, result: { ok: true } });
    }) as unknown as typeof fetch;

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: true,
      fetchImpl,
    });

    const result = await client.post('/session/status', { session_id: 's1' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/health',
      expect.anything()
    );
    expect(result).toEqual({ ok: true, result: { ok: true } });
  });

  it('restarts a daemon that predates the current build', async () => {
    let healthy = true;
    let healthChecks = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return makeResponse({ ok: healthy });
      }
      if (url.endsWith('/health/check')) {
        healthChecks += 1;
        return makeResponse({
          ok: true,
          result: {
            started_at:
              healthChecks === 1
                ? '2026-03-10T00:00:00.000Z'
                : '2026-03-15T00:00:00.000Z',
            pid: 4242,
          },
        });
      }
      return makeResponse({ ok: true, result: { ok: true } });
    }) as unknown as typeof fetch;
    const killProcess = vi.fn(() => {
      healthy = false;
    });
    const spawnImpl = vi.fn(() => {
      healthy = true;
      return {
        on: () => undefined,
        unref: () => undefined,
      };
    }) as unknown as typeof import('node:child_process').spawn;

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: true,
      fetchImpl,
      spawnImpl,
      currentBuildTimeMs: Date.parse('2026-03-14T12:00:00.000Z'),
      killProcess,
    });

    const result = await client.post('/session/status', { session_id: 's1' });

    expect(killProcess).toHaveBeenCalledWith(4242);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, result: { ok: true } });
  });

  it('ignores persisted runtime routing metadata when options and env are absent', () => {
    const root = createGitRoot('cli-core-client-metadata-root-');
    const metadataDir = path.join(root, '.context', 'browser-bridge');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      path.join(metadataDir, 'dev.json'),
      JSON.stringify({ host: '127.0.0.9', port: 4333 }),
      'utf8'
    );

    const client = createCoreClient({
      cwd: root,
      ensureDaemon: false,
    });

    expect(client.baseUrl).toBe('http://127.0.0.1:3210');
  });

  it('uses env values over metadata and explicit options over env', async () => {
    const root = createGitRoot('cli-core-client-precedence-root-');
    const metadataDir = path.join(root, '.context', 'browser-bridge');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      path.join(metadataDir, 'dev.json'),
      JSON.stringify({ host: 'metadata.local', port: 4666 }),
      'utf8'
    );

    await withEnv(
      {
        BROWSER_BRIDGE_CORE_HOST: 'env.local',
        BROWSER_BRIDGE_CORE_PORT: '4777',
      },
      async () => {
        const fromEnv = createCoreClient({
          cwd: root,
          ensureDaemon: false,
        });
        expect(fromEnv.baseUrl).toBe('http://env.local:4777');

        const fromOptions = createCoreClient({
          cwd: root,
          host: 'option.local',
          port: 4888,
          ensureDaemon: false,
        });
        expect(fromOptions.baseUrl).toBe('http://option.local:4888');
      }
    );
  });

  it('attaches cli caller runtime context to diagnostics doctor payload', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(
      async (_url: string, init?: Parameters<typeof fetch>[1]) => {
        if (init?.body && typeof init.body === 'string') {
          capturedBody = JSON.parse(init.body) as Record<string, unknown>;
        }
        return makeResponse({ ok: true, result: { ok: true } });
      }
    ) as unknown as typeof fetch;

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: false,
      fetchImpl,
    });

    await client.post('/diagnostics/doctor', { session_id: 'session-1' });

    expect(capturedBody).toEqual(
      expect.objectContaining({
        session_id: 'session-1',
        caller: expect.objectContaining({
          endpoint: expect.objectContaining({
            host: '127.0.0.1',
            port: 3210,
            base_url: 'http://127.0.0.1:3210',
          }),
          process: expect.objectContaining({
            component: 'cli',
          }),
        }),
      })
    );
    expect(capturedBody?.caller).not.toHaveProperty('endpoint.metadata_path');
    expect(capturedBody?.caller).not.toHaveProperty('endpoint.isolated_mode');
  });

  it('returns a structured error when core responds with html instead of json', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse('<!DOCTYPE html><html><body>nope</body></html>', {
        rawText: '<!DOCTYPE html><html><body>nope</body></html>',
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      })
    ) as unknown as typeof fetch;

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: false,
      fetchImpl,
    });

    await expect(
      client.post('/diagnostics/enable_inspect')
    ).rejects.toMatchObject({
      info: expect.objectContaining({
        code: 'UNAVAILABLE',
        message: 'Core returned HTML instead of JSON.',
        retryable: true,
        details: expect.objectContaining({
          path: '/diagnostics/enable_inspect',
          status: 200,
          content_type: 'text/html; charset=utf-8',
          reason: 'core_invalid_json_response',
          response_preview: '<!DOCTYPE html><html><body>nope</body></html>',
        }),
      }),
    });
  });

  it('returns a structured error when core responds with an empty body', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse(undefined, {
        rawText: '',
        status: 503,
        ok: false,
      })
    ) as unknown as typeof fetch;

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: false,
      fetchImpl,
    });

    await expect(client.post('/session/create')).rejects.toMatchObject({
      info: expect.objectContaining({
        code: 'UNAVAILABLE',
        message: 'Core returned an empty response.',
        retryable: true,
        details: expect.objectContaining({
          path: '/session/create',
          status: 503,
          reason: 'core_empty_response',
        }),
      }),
    });
  });
});
