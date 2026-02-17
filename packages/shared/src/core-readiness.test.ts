import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreReadinessController } from './core-readiness';

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

const makeResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  while (trackedTempDirs.length > 0) {
    const dir = trackedTempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('createCoreReadinessController', () => {
  it('uses the default runtime when no metadata/env/options are present', () => {
    const cwd = createTempDir('core-readiness-default-');
    const controller = createCoreReadinessController({
      cwd,
      ensureDaemon: false,
    });
    expect(controller.baseUrl).toBe('http://127.0.0.1:3210');
  });

  it('resolves metadata host with default port outside isolated mode', () => {
    const root = createGitRoot('core-readiness-metadata-');
    const metadataDir = path.join(root, '.context', 'browser-bridge');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      path.join(metadataDir, 'dev.json'),
      JSON.stringify({ host: '127.0.0.8', port: 4999 }),
      'utf8'
    );

    const controller = createCoreReadinessController({
      cwd: root,
      ensureDaemon: false,
    });
    expect(controller.baseUrl).toBe('http://127.0.0.8:3210');
  });

  it('applies option > env > metadata precedence', async () => {
    const root = createGitRoot('core-readiness-precedence-');
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
        const fromEnv = createCoreReadinessController({
          cwd: root,
          ensureDaemon: false,
        });
        expect(fromEnv.baseUrl).toBe('http://env.local:5222');

        const fromOptions = createCoreReadinessController({
          cwd: root,
          host: 'option.local',
          port: 5333,
          ensureDaemon: false,
        });
        expect(fromOptions.baseUrl).toBe('http://option.local:5333');
      }
    );
  });

  it('spawns core once when health is initially unavailable', async () => {
    let healthAttempts = 0;
    const fetchImpl = vi.fn(async () => {
      healthAttempts += 1;
      return makeResponse({ ok: healthAttempts > 1 });
    }) as unknown as typeof fetch;
    const spawnDaemon = vi.fn();
    const controller = createCoreReadinessController({
      host: '127.0.0.1',
      port: 3210,
      fetchImpl,
      spawnDaemon,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 5,
    });

    await controller.ensureReady();

    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await controller.ensureReady();
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });
});
