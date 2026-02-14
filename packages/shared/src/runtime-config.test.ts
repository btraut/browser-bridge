import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_DIRECTORY_RELATIVE_PATH,
  createBoundedPortProbeSequence,
  findGitRoot,
  readRuntimeMetadata,
  resolveCoreRuntime,
  resolveDeterministicCorePort,
  resolveLogDirectory,
  resolveRuntimeMetadataPath,
  resolveWorktreeId,
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

  it('extracts worktree id from gitdir metadata', () => {
    const root = createTempDir('runtime-config-worktree-root-');
    const gitDir = createTempDir('runtime-config-main-git-');
    const worktreeGitDir = path.join(
      gitDir,
      '.git',
      'worktrees',
      'feature-123'
    );
    mkdirSync(path.join(root), { recursive: true });
    mkdirSync(worktreeGitDir, { recursive: true });
    writeFileSync(
      path.join(root, '.git'),
      `gitdir: ${worktreeGitDir}\n`,
      'utf8'
    );

    expect(resolveWorktreeId({ cwd: root })).toBe('feature-123');
  });

  it('uses deterministic git ports and preserves legacy non-git default', () => {
    const gitRoot = createGitRoot('runtime-config-port-root-');
    const nonGitRoot = createTempDir('runtime-config-non-git-root-');

    const portA = resolveDeterministicCorePort({ cwd: gitRoot });
    const portB = resolveDeterministicCorePort({ cwd: gitRoot });

    expect(portA).toBe(portB);
    expect(portA).toBeGreaterThanOrEqual(3210);
    expect(resolveDeterministicCorePort({ cwd: nonGitRoot })).toBe(3210);
  });

  it('writes and reads runtime metadata from .context/browser-bridge/dev.json', () => {
    const root = createGitRoot('runtime-config-metadata-root-');

    const metadataPath = writeRuntimeMetadata(
      {
        host: '127.0.0.9',
        port: 4123,
        worktree_id: 'feature-abc',
      },
      { cwd: root }
    );

    expect(metadataPath).toBe(
      resolveRuntimeMetadataPath({ cwd: root, gitRoot: root })
    );

    expect(readRuntimeMetadata({ cwd: root })).toEqual({
      host: '127.0.0.9',
      port: 4123,
      worktree_id: 'feature-abc',
      git_root: undefined,
      updated_at: undefined,
    });
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

  it('builds bounded probe sequences', () => {
    expect(createBoundedPortProbeSequence(4400, 4)).toEqual([
      4400, 4401, 4402, 4403,
    ]);
    expect(createBoundedPortProbeSequence(65534, 5)).toEqual([65534, 65535]);
  });

  it('applies precedence option > env > metadata > deterministic/default', async () => {
    const root = createGitRoot('runtime-config-precedence-root-');
    writeRuntimeMetadata({ host: 'metadata.local', port: 4545 }, { cwd: root });

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
        const fromMetadata = resolveCoreRuntime({ cwd: root });
        expect(fromMetadata.host).toBe('metadata.local');
        expect(fromMetadata.port).toBe(4545);
        expect(fromMetadata.hostSource).toBe('metadata');
        expect(fromMetadata.portSource).toBe('metadata');
      }
    );

    rmSync(resolveRuntimeMetadataPath({ cwd: root }), { force: true });
    const fromDeterministic = resolveCoreRuntime({ cwd: root });
    expect(fromDeterministic.port).toBe(fromDeterministic.deterministicPort);
    expect(fromDeterministic.portSource).toBe('deterministic');
    expect(fromDeterministic.host).toBe('127.0.0.1');
    expect(fromDeterministic.hostSource).toBe('default');

    const nonGitRoot = createTempDir('runtime-config-precedence-non-git-root-');
    const nonGitRuntime = resolveCoreRuntime({ cwd: nonGitRoot });
    expect(nonGitRuntime.port).toBe(3210);
    expect(nonGitRuntime.portSource).toBe('deterministic');
  });
});
