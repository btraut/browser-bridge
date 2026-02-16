import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreClient } from './core-client';

const makeResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
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

describe('mcp core client', () => {
  it('uses metadata host with default port when no env/options are provided', async () => {
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
      'http://127.0.0.5:3210/session/create',
      expect.anything()
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
});
