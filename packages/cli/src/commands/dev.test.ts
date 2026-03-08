import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedCoreRuntime } from '@btraut/browser-bridge-shared';
import {
  resolveCoreRuntime,
  resolveLogDirectory,
  writeRuntimeMetadata,
} from '@btraut/browser-bridge-shared';
import { runLocal } from '../cli-runtime';
import { openPath } from '../open-path';
import { discoverActivationExtensionId } from '../extension-id-discovery';
import {
  buildActivationOptionsUrl,
  registerDevCommands,
  resolveActivationExtensionId,
} from './dev';

vi.mock('../cli-runtime', () => ({
  runLocal: vi.fn(),
}));

vi.mock('../open-path', () => ({
  openPath: vi.fn(),
}));

vi.mock('../extension-id-discovery', () => ({
  discoverActivationExtensionId: vi.fn(async () => ({
    kind: 'none',
    searchedPaths: [],
  })),
}));

vi.mock('@btraut/browser-bridge-shared', async () => {
  const actual = await vi.importActual('@btraut/browser-bridge-shared');
  return {
    ...actual,
    resolveCoreRuntime: vi.fn(),
    resolveLogDirectory: vi.fn(),
    writeRuntimeMetadata: vi.fn((_, options?: { metadataPath?: string }) => {
      return options?.metadataPath ?? '/tmp/dev.json';
    }),
  };
});

const buildProgram = (): Command => {
  const program = new Command();
  program
    .option('--host <host>')
    .option('--port <port>')
    .option('--json')
    .option('--no-daemon');
  registerDevCommands(program);
  program.exitOverride();
  return program;
};

const createRuntime = (
  overrides: Partial<ResolvedCoreRuntime> = {}
): ResolvedCoreRuntime => ({
  host: '127.0.0.1',
  port: 4321,
  hostSource: 'default',
  portSource: 'default',
  metadataPath: '/tmp/runtime/dev.json',
  metadata: {
    host: '127.0.0.1',
    port: 4321,
    extension_id: 'metadata-ext',
  },
  gitRoot: '/tmp/repo',
  worktreeId: 'wt-abc',
  deterministicPort: 4321,
  isolatedMode: false,
  isolatedModeSource: 'default',
  ...overrides,
});

describe('dev command helpers', () => {
  it('resolves extension id precedence flag > env > metadata', () => {
    expect(
      resolveActivationExtensionId({
        optionExtensionId: 'flag-ext',
        envExtensionId: 'env-ext',
        metadataExtensionId: 'meta-ext',
      })
    ).toEqual({ extensionId: 'flag-ext', source: 'flag' });

    expect(
      resolveActivationExtensionId({
        envExtensionId: 'env-ext',
        metadataExtensionId: 'meta-ext',
      })
    ).toEqual({ extensionId: 'env-ext', source: 'env' });

    expect(
      resolveActivationExtensionId({
        metadataExtensionId: 'meta-ext',
      })
    ).toEqual({ extensionId: 'meta-ext', source: 'metadata' });
  });

  it('returns null when no extension id source exists', () => {
    expect(resolveActivationExtensionId({})).toBeNull();
  });

  it('builds options URL with activation params', () => {
    expect(
      buildActivationOptionsUrl({
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        corePort: 4567,
        worktreeId: 'wt-abc',
      })
    ).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html?bb_activate=1&corePort=4567&worktreeId=wt-abc'
    );
  });
});

describe('dev commands', () => {
  const originalExtensionId = process.env.BROWSER_BRIDGE_EXTENSION_ID;

  beforeEach(() => {
    vi.mocked(runLocal).mockReset();
    vi.mocked(resolveCoreRuntime).mockReset();
    vi.mocked(resolveLogDirectory).mockReset();
    vi.mocked(openPath).mockReset();
    vi.mocked(discoverActivationExtensionId).mockReset();
    vi.mocked(discoverActivationExtensionId).mockResolvedValue({
      kind: 'none',
      searchedPaths: [],
    });
    delete process.env.BROWSER_BRIDGE_EXTENSION_ID;
  });

  afterEach(() => {
    if (originalExtensionId === undefined) {
      delete process.env.BROWSER_BRIDGE_EXTENSION_ID;
      return;
    }
    process.env.BROWSER_BRIDGE_EXTENSION_ID = originalExtensionId;
  });

  it('dev info returns resolved runtime details', async () => {
    const runtime = createRuntime();
    vi.mocked(resolveCoreRuntime).mockReturnValue(runtime);
    vi.mocked(resolveLogDirectory).mockReturnValue('/tmp/repo/.context/logs');

    let envelope: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      envelope = await work({
        host: '10.0.0.8',
        port: '4545',
        json: false,
      });
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      '--host',
      '10.0.0.8',
      '--port',
      '4545',
      'dev',
      'info',
    ]);

    expect(resolveCoreRuntime).toHaveBeenCalledWith({
      host: '10.0.0.8',
      port: '4545',
      strictEnvPort: true,
    });
    expect(resolveLogDirectory).toHaveBeenCalledWith({
      gitRoot: runtime.gitRoot,
    });
    expect(envelope).toEqual({
      ok: true,
      result: {
        host: '127.0.0.1',
        hostSource: 'default',
        port: 4321,
        portSource: 'default',
        deterministicPort: 4321,
        worktreeId: 'wt-abc',
        metadataPath: '/tmp/runtime/dev.json',
        logDir: '/tmp/repo/.context/logs',
        metadataSnapshot: runtime.metadata,
      },
    });
  });

  it('dev activate persists runtime metadata and opens extension options URL', async () => {
    const runtime = createRuntime();
    vi.mocked(resolveCoreRuntime).mockReturnValue(runtime);

    let envelope: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      envelope = await work({ json: false });
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'dev',
      'activate',
      '--extension-id',
      'flag-ext',
    ]);

    expect(resolveCoreRuntime).toHaveBeenCalledWith({
      host: undefined,
      port: undefined,
      isolatedMode: true,
      strictEnvPort: true,
    });
    expect(vi.mocked(writeRuntimeMetadata)).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 4321,
        git_root: '/tmp/repo',
        worktree_id: 'wt-abc',
        extension_id: 'flag-ext',
        isolated_mode: true,
        updated_at: expect.any(String),
      }),
      { metadataPath: '/tmp/runtime/dev.json' }
    );
    expect(openPath).toHaveBeenCalledWith(
      'chrome-extension://flag-ext/options.html?bb_activate=1&corePort=4321&worktreeId=wt-abc'
    );
    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'flag-ext',
        extensionIdSource: 'flag',
        host: '127.0.0.1',
        port: 4321,
        isolatedMode: true,
        metadataPath: '/tmp/runtime/dev.json',
        activationUrl:
          'chrome-extension://flag-ext/options.html?bb_activate=1&corePort=4321&worktreeId=wt-abc',
      },
    });
  });

  it('dev activate uses env extension id when flag is absent', async () => {
    process.env.BROWSER_BRIDGE_EXTENSION_ID = 'env-ext';
    const runtime = createRuntime({
      metadata: {
        extension_id: 'metadata-ext',
      },
    });
    vi.mocked(resolveCoreRuntime).mockReturnValue(runtime);
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      await work({ json: false });
    });

    const program = buildProgram();
    await program.parseAsync(['node', 'cli', 'dev', 'activate']);

    expect(openPath).toHaveBeenCalledWith(
      'chrome-extension://env-ext/options.html?bb_activate=1&corePort=4321&worktreeId=wt-abc'
    );
  });

  it('dev activate fails with actionable error when extension id is missing', async () => {
    const runtime = createRuntime({ metadata: null });
    vi.mocked(resolveCoreRuntime).mockReturnValue(runtime);
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      await work({ json: false });
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'cli', 'dev', 'activate'])
    ).rejects.toThrow('Missing extension id.');
  });

  it('dev activate uses discovered connected extension id when explicit sources are missing', async () => {
    const isolatedRuntime = createRuntime({
      metadata: null,
      port: 4321,
      isolatedMode: true,
    });
    const sharedRuntime = createRuntime({
      metadata: null,
      port: 3210,
      isolatedMode: false,
    });
    vi.mocked(resolveCoreRuntime)
      .mockReturnValueOnce(isolatedRuntime)
      .mockReturnValueOnce(sharedRuntime);
    vi.mocked(discoverActivationExtensionId).mockResolvedValue({
      kind: 'resolved',
      extensionId: 'connected-ext',
      source: 'connected',
      searchedPaths: [],
    });

    let envelope: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      envelope = await work({ json: false });
    });

    const program = buildProgram();
    await program.parseAsync(['node', 'cli', 'dev', 'activate']);

    expect(discoverActivationExtensionId).toHaveBeenCalledWith(sharedRuntime);
    expect(openPath).toHaveBeenCalledWith(
      'chrome-extension://connected-ext/options.html?bb_activate=1&corePort=4321&worktreeId=wt-abc'
    );
    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'connected-ext',
        extensionIdSource: 'connected',
        host: '127.0.0.1',
        port: 4321,
        isolatedMode: true,
        metadataPath: '/tmp/runtime/dev.json',
        activationUrl:
          'chrome-extension://connected-ext/options.html?bb_activate=1&corePort=4321&worktreeId=wt-abc',
      },
    });
  });

  it('dev activate errors deterministically when discovered ids are ambiguous', async () => {
    const isolatedRuntime = createRuntime({
      metadata: null,
      port: 4321,
      isolatedMode: true,
    });
    const sharedRuntime = createRuntime({
      metadata: null,
      port: 3210,
      isolatedMode: false,
    });
    vi.mocked(resolveCoreRuntime)
      .mockReturnValueOnce(isolatedRuntime)
      .mockReturnValueOnce(sharedRuntime);
    vi.mocked(discoverActivationExtensionId).mockResolvedValue({
      kind: 'ambiguous',
      candidates: [
        'aaaabbbbccccddddeeeeffffgggghhhh',
        'hhhhggggffffeeeeddddccccbbbbaaaa',
      ],
      searchedPaths: ['/tmp/Profile 1/Secure Preferences'],
    });
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      await work({ json: false });
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'cli', 'dev', 'activate'])
    ).rejects.toThrow('Multiple Browser Bridge extension ids discovered');
    expect(discoverActivationExtensionId).toHaveBeenCalledWith(sharedRuntime);
  });
});
