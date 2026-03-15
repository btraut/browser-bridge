import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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

  it('ignores persisted runtime routing metadata and uses the default endpoint', () => {
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
    expect(controller.baseUrl).toBe('http://127.0.0.1:3210');
  });

  it('applies option > env > default precedence', async () => {
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
    let postAttempts = 0;
    const fetchImpl = vi.fn(
      async (_url: string, init?: Parameters<typeof fetch>[1]) => {
        if (init?.method === 'GET') {
          return makeResponse({ ok: false }, false);
        }
        postAttempts += 1;
        return makeResponse({ ok: postAttempts > 1 });
      }
    ) as unknown as typeof fetch;
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
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await controller.ensureReady();
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('retries readiness after a failed startup attempt', async () => {
    let healthy = false;
    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: healthy })
    ) as unknown as typeof fetch;
    const spawnDaemon = vi.fn();
    const controller = createCoreReadinessController({
      host: '127.0.0.1',
      port: 3210,
      fetchImpl,
      spawnDaemon,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 1,
      healthBudgetMs: 20,
    });

    await expect(controller.ensureReady()).rejects.toThrow(/failed to start/i);
    expect(spawnDaemon).toHaveBeenCalledTimes(1);

    healthy = true;
    await expect(controller.ensureReady()).resolves.toBeUndefined();
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });

  it('falls back to GET /health when POST is unavailable', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init?: Parameters<typeof fetch>[1]) => {
        if (init?.method === 'POST') {
          return makeResponse({ ok: false }, false);
        }
        return makeResponse({ ok: true });
      }
    ) as unknown as typeof fetch;
    const spawnDaemon = vi.fn();
    const controller = createCoreReadinessController({
      host: '127.0.0.1',
      port: 3210,
      fetchImpl,
      spawnDaemon,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 2,
      healthBudgetMs: 25,
    });

    await expect(controller.ensureReady()).resolves.toBeUndefined();
    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/health',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/health',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns actionable guidance when target port is occupied by an unhealthy process', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: false }, false)
    ) as unknown as typeof fetch;
    const spawnDaemon = vi.fn();
    const controller = createCoreReadinessController({
      host: '127.0.0.1',
      port: 3210,
      fetchImpl,
      spawnDaemon,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 1,
      healthBudgetMs: 20,
      portReachabilityCheck: vi.fn(async () => true),
    });

    await expect(controller.ensureReady()).rejects.toThrow(
      /--no-daemon to reuse the existing process or stop whatever is already bound/i
    );
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent ensureReady callers', async () => {
    let postChecks = 0;
    let releaseReadyCheck: (() => void) | undefined;
    const readyCheck = new Promise<void>((resolve) => {
      releaseReadyCheck = () => resolve();
    });
    const fetchSpy = vi.fn(
      async (_url: string, init?: Parameters<typeof fetch>[1]) => {
        if (init?.method === 'GET') {
          return makeResponse({ ok: false });
        }
        postChecks += 1;
        if (postChecks === 1) {
          return makeResponse({ ok: false });
        }
        await readyCheck;
        return makeResponse({ ok: true });
      }
    );
    const fetchImpl = fetchSpy as unknown as typeof fetch;
    const spawnDaemon = vi.fn();
    const controller = createCoreReadinessController({
      host: '127.0.0.1',
      port: 3210,
      fetchImpl,
      spawnDaemon,
      ensureDaemon: true,
      healthRetryMs: 1,
      healthAttempts: 3,
      healthBudgetMs: 100,
    });

    const first = controller.ensureReady();
    const second = controller.ensureReady();
    await delay(5);
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    releaseReadyCheck?.();
    await Promise.all([first, second]);
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
