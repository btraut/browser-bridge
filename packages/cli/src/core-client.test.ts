import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreClient } from './core-client';

const makeResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
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
        headers: { 'content-type': 'application/json' },
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

  it('uses metadata host with default port when options and env are absent', () => {
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

    expect(client.baseUrl).toBe('http://127.0.0.9:3210');
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
});
