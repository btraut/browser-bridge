import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HTTP_CONTRACT_VERSION,
  HTTP_CONTRACT_VERSION_HEADER,
} from '@btraut/browser-bridge-shared';
import { createCoreClient } from './core-client';

const makeResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const makeSpawnImpl = (): typeof spawn =>
  vi.fn(
    () =>
      ({
        on: vi.fn(),
        unref: vi.fn(),
      }) as unknown as ReturnType<typeof spawn>
  ) as unknown as typeof spawn;

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

describe('mcp core client', () => {
  it('ignores persisted runtime routing metadata when no env/options are provided', async () => {
    const root = createGitRoot('mcp-core-client-metadata-root-');
    const metadataDir = path.join(root, '.context', 'browser-bridge');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      path.join(metadataDir, 'dev.json'),
      JSON.stringify({ host: '127.0.0.5', port: 4999 }),
      'utf8'
    );

    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: true, result: { ok: true } })
    ) as unknown as typeof fetch;

    const client = createCoreClient({
      cwd: root,
      fetchImpl,
    });

    await client.post('/session/create', {});

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/session/create',
      expect.objectContaining({
        headers: {
          'content-type': 'application/json',
          [HTTP_CONTRACT_VERSION_HEADER]: HTTP_CONTRACT_VERSION,
        },
      })
    );
  });

  it('respects option > env > metadata precedence for host and port', async () => {
    const root = createGitRoot('mcp-core-client-precedence-root-');
    const metadataDir = path.join(root, '.context', 'browser-bridge');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      path.join(metadataDir, 'dev.json'),
      JSON.stringify({ host: 'metadata.local', port: 5111 }),
      'utf8'
    );

    await withEnv(
      {
        BROWSER_BRIDGE_CORE_HOST: 'env.local',
        BROWSER_BRIDGE_CORE_PORT: '5222',
      },
      async () => {
        const fromEnv = createCoreClient({ cwd: root });
        expect(fromEnv.baseUrl).toBe('http://env.local:5222');

        const fromOptions = createCoreClient({
          cwd: root,
          host: 'option.local',
          port: 5333,
        });
        expect(fromOptions.baseUrl).toBe('http://option.local:5333');
      }
    );
  });

  it('auto-starts core on first request when ensureDaemon is enabled', async () => {
    let healthChecks = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        healthChecks += 1;
        return makeResponse({ ok: healthChecks > 2 });
      }
      return makeResponse({ ok: true, result: { started: true } });
    }) as unknown as typeof fetch;

    const spawnImpl = makeSpawnImpl();

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 5,
      fetchImpl,
      spawnImpl,
    });

    const result = await client.post('/session/create', {});

    expect(result).toEqual({ ok: true, result: { started: true } });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/health',
      expect.anything()
    );
  });

  it('returns retryable unavailable envelope when ensure-ready cannot make core healthy', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return makeResponse({ ok: false });
      }
      return makeResponse({ ok: true, result: { unexpected: true } });
    }) as unknown as typeof fetch;

    const spawnImpl = makeSpawnImpl();

    const client = createCoreClient({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 2,
      fetchImpl,
      spawnImpl,
    });

    await expect(client.post('/session/create', {})).rejects.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'UNAVAILABLE',
          retryable: true,
        }),
      })
    );

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      'http://127.0.0.1:3210/session/create',
      expect.anything()
    );
  });

  it('attaches mcp caller runtime context to diagnostics doctor payload', async () => {
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
            component: 'mcp',
          }),
        }),
      })
    );
    expect(capturedBody?.caller).not.toHaveProperty('endpoint.metadata_path');
    expect(capturedBody?.caller).not.toHaveProperty('endpoint.isolated_mode');
  });
});
