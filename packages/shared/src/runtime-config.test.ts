import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_DIRECTORY_RELATIVE_PATH,
  findGitRoot,
  readRuntimeMetadata,
  resolveCoreRuntime,
  resolveLogDirectory,
  resolveRuntimeMetadataPath,
  writeRuntimeMetadata,
} from './runtime-config';

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
  values: Record<string, string | undefined>,
  work: () => Promise<T> | T
): Promise<T> => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await work();
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

describe('runtime-config', () => {
  it('finds a git root from nested directories', () => {
    const root = createGitRoot('runtime-config-git-root-');
    const nested = path.join(root, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });

    expect(findGitRoot(nested)).toBe(root);
  });

  it('writes and reads runtime metadata from .context/browser-bridge/dev.json', () => {
    const root = createGitRoot('runtime-config-metadata-root-');

    const metadataPath = writeRuntimeMetadata(
      {
        extension_id: 'abcdefghijklmnopabcdefghijklmnop',
      },
      { cwd: root }
    );

    expect(metadataPath).toBe(
      resolveRuntimeMetadataPath({ cwd: root, gitRoot: root })
    );

    expect(readRuntimeMetadata({ cwd: root })).toEqual({
      extension_id: 'abcdefghijklmnopabcdefghijklmnop',
      updated_at: undefined,
    });
  });

  it('ignores invalid metadata values', () => {
    const root = createGitRoot('runtime-config-extension-id-root-');
    const metadataPath = resolveRuntimeMetadataPath({ cwd: root });
    mkdirSync(path.dirname(metadataPath), { recursive: true });

    writeFileSync(
      metadataPath,
      JSON.stringify({ extension_id: '   ', host: '' }),
      'utf8'
    );

    expect(readRuntimeMetadata({ cwd: root })).toBeNull();
  });

  it('resolves default log directory from git root', () => {
    const root = createGitRoot('runtime-config-log-dir-root-');
    const nested = path.join(root, 'nested', 'dir');
    mkdirSync(nested, { recursive: true });

    expect(resolveLogDirectory({ cwd: nested })).toBe(
      path.join(root, DEFAULT_LOG_DIRECTORY_RELATIVE_PATH)
    );
  });

  it('falls back to cwd for default log directory when not in a git repo', () => {
    const cwd = createTempDir('runtime-config-log-dir-cwd-');
    expect(resolveLogDirectory({ cwd })).toBe(
      path.join(cwd, DEFAULT_LOG_DIRECTORY_RELATIVE_PATH)
    );
  });

  it('uses BROWSER_BRIDGE_CWD when cwd input is omitted', async () => {
    const root = createGitRoot('runtime-config-env-cwd-root-');
    const nested = path.join(root, 'nested', 'cwd');
    mkdirSync(nested, { recursive: true });

    await withEnv(
      {
        BROWSER_BRIDGE_CWD: nested,
      },
      async () => {
        expect(resolveLogDirectory()).toBe(
          path.join(root, DEFAULT_LOG_DIRECTORY_RELATIVE_PATH)
        );
        expect(resolveRuntimeMetadataPath()).toBe(
          path.join(root, '.context', 'browser-bridge', 'dev.json')
        );
      }
    );
  });

  it('applies precedence option > env > default and ignores metadata routing', async () => {
    const root = createGitRoot('runtime-config-precedence-root-');
    writeRuntimeMetadata(
      {
        extension_id: 'abcdefghijklmnopabcdefghijklmnop',
      },
      { cwd: root }
    );

    await withEnv(
      {
        BROWSER_BRIDGE_CORE_HOST: 'env.local',
        BROWSER_BRIDGE_CORE_PORT: '5656',
        BROWSER_VISION_CORE_HOST: undefined,
        BROWSER_VISION_CORE_PORT: undefined,
      },
      async () => {
        const fromOptions = resolveCoreRuntime({
          cwd: root,
          host: 'option.local',
          port: 6767,
          strictEnvPort: true,
        });
        expect(fromOptions.host).toBe('option.local');
        expect(fromOptions.port).toBe(6767);
        expect(fromOptions.hostSource).toBe('option');
        expect(fromOptions.portSource).toBe('option');

        const fromEnv = resolveCoreRuntime({
          cwd: root,
          strictEnvPort: true,
        });
        expect(fromEnv.host).toBe('env.local');
        expect(fromEnv.port).toBe(5656);
        expect(fromEnv.hostSource).toBe('env');
        expect(fromEnv.portSource).toBe('env');
      }
    );

    await withEnv(
      {
        BROWSER_BRIDGE_CORE_HOST: undefined,
        BROWSER_BRIDGE_CORE_PORT: undefined,
        BROWSER_VISION_CORE_HOST: undefined,
        BROWSER_VISION_CORE_PORT: undefined,
      },
      async () => {
        const fromDefault = resolveCoreRuntime({ cwd: root });
        expect(fromDefault.host).toBe('127.0.0.1');
        expect(fromDefault.port).toBe(3210);
        expect(fromDefault.hostSource).toBe('default');
        expect(fromDefault.portSource).toBe('default');
        expect(fromDefault.metadata).toEqual({
          extension_id: 'abcdefghijklmnopabcdefghijklmnop',
          updated_at: undefined,
        });
      }
    );
  });
});
