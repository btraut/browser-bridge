import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DiagnosticReport,
  ResolvedCoreRuntime,
} from '@btraut/browser-bridge-shared';
import {
  resolveCoreRuntime,
  resolveLogDirectory,
} from '@btraut/browser-bridge-shared';
import { runLocal } from '../cli-runtime';
import { createCoreClient } from '../core-client';
import { discoverActivationExtensionId } from '../extension-id-discovery';
import { registerDevCommands, resolveActivationExtensionId } from './dev';

vi.mock('../cli-runtime', () => ({
  runLocal: vi.fn(),
}));

vi.mock('../core-client', () => ({
  createCoreClient: vi.fn(),
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
  port: 3210,
  hostSource: 'default',
  portSource: 'default',
  metadataPath: '/tmp/runtime/dev.json',
  metadata: {
    extension_id: 'metadata-ext',
  },
  gitRoot: '/tmp/repo',
  ...overrides,
});

const inspectReport = (
  options: {
    inspectCapability?: boolean;
    extensionConnected?: boolean;
    extensionId?: string;
  } = {}
): DiagnosticReport => {
  const runtime =
    options.extensionId === undefined
      ? {}
      : {
          extension: {
            extension_id: options.extensionId,
          },
        };

  return {
    ok: options.inspectCapability ?? false,
    extension: {
      connected: options.extensionConnected ?? true,
    },
    runtime,
    checks: [
      {
        name: 'inspect.capability',
        ok: options.inspectCapability ?? false,
      },
    ],
  };
};

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
});

describe('dev commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCoreRuntime).mockReturnValue(createRuntime());
    vi.mocked(resolveLogDirectory).mockReturnValue('/tmp/repo/.context/logs');
    vi.mocked(discoverActivationExtensionId).mockResolvedValue({
      kind: 'none',
      searchedPaths: [],
    });
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      await work({ json: false });
    });
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async (path: string) => {
        if (path === '/diagnostics/enable_inspect') {
          return {
            ok: true as const,
            result: { ok: true, enabled: true, extension_id: 'flag-ext' },
          };
        }
        return {
          ok: true as const,
          result: inspectReport({
            inspectCapability: true,
            extensionId: 'flag-ext',
          }),
        };
      }),
    } as ReturnType<typeof createCoreClient>);
  });

  afterEach(() => {
    delete process.env.BROWSER_BRIDGE_EXTENSION_ID;
    delete process.env.BROWSER_BRIDGE_ENABLE_INSPECT_TIMEOUT_MS;
  });

  it('dev info returns resolved runtime details', async () => {
    const runtime = createRuntime({
      metadata: {
        extension_id: 'metadata-ext',
      },
    });
    vi.mocked(resolveCoreRuntime).mockReturnValue(runtime);

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
        port: 3210,
        portSource: 'default',
        metadataPath: '/tmp/runtime/dev.json',
        logDir: '/tmp/repo/.context/logs',
        metadataSnapshot: runtime.metadata,
      },
    });
  });

  it('enable-inspect enables inspect through the core-extension bridge and waits for capability', async () => {
    let envelope: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      envelope = await work({ json: false });
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'dev',
      'enable-inspect',
      '--extension-id',
      'flag-ext',
    ]);

    expect(createCoreClient).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: true,
    });
    const client = vi.mocked(createCoreClient).mock.results[0]
      ?.value as ReturnType<typeof createCoreClient>;
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      '/diagnostics/enable_inspect',
      { extension_id: 'flag-ext' }
    );
    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'flag-ext',
        extensionIdSource: 'flag',
        host: '127.0.0.1',
        port: 3210,
        inspectAlwaysEnabled: true,
      },
    });
  });

  it('enable-inspect uses env extension id when flag is absent', async () => {
    process.env.BROWSER_BRIDGE_EXTENSION_ID = 'env-ext';
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async (path: string) => {
        if (path === '/diagnostics/enable_inspect') {
          return {
            ok: true as const,
            result: { ok: true, enabled: true, extension_id: 'env-ext' },
          };
        }
        return {
          ok: true as const,
          result: inspectReport({
            inspectCapability: true,
            extensionId: 'env-ext',
          }),
        };
      }),
    } as ReturnType<typeof createCoreClient>);

    const program = buildProgram();
    await program.parseAsync(['node', 'cli', 'dev', 'enable-inspect']);

    const client = vi.mocked(createCoreClient).mock.results[0]
      ?.value as ReturnType<typeof createCoreClient>;
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      '/diagnostics/enable_inspect',
      { extension_id: 'env-ext' }
    );
  });

  it('enable-inspect uses discovered connected extension id when explicit sources are missing', async () => {
    vi.mocked(resolveCoreRuntime).mockReturnValue(
      createRuntime({ metadata: null })
    );
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async (path: string) => {
        if (path === '/diagnostics/enable_inspect') {
          return {
            ok: true as const,
            result: {
              ok: true,
              enabled: true,
              extension_id: 'connected-ext',
            },
          };
        }
        return {
          ok: true as const,
          result: inspectReport({
            inspectCapability: true,
            extensionId: 'connected-ext',
          }),
        };
      }),
    } as ReturnType<typeof createCoreClient>);
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
    await program.parseAsync(['node', 'cli', 'dev', 'enable-inspect']);

    expect(discoverActivationExtensionId).toHaveBeenCalledWith([
      createRuntime({ metadata: null }),
    ]);
    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'connected-ext',
        extensionIdSource: 'connected',
        host: '127.0.0.1',
        port: 3210,
        inspectAlwaysEnabled: true,
      },
    });
  });

  it('enable-inspect fails with actionable error when extension id is missing', async () => {
    delete process.env.BROWSER_BRIDGE_EXTENSION_ID;
    vi.mocked(resolveCoreRuntime).mockReturnValue(
      createRuntime({ metadata: null })
    );

    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'cli', 'dev', 'enable-inspect'])
    ).rejects.toThrow('Missing extension id.');
  });

  it('enable-inspect errors deterministically when discovered ids are ambiguous', async () => {
    vi.mocked(resolveCoreRuntime).mockReturnValue(
      createRuntime({ metadata: null })
    );
    vi.mocked(discoverActivationExtensionId).mockResolvedValue({
      kind: 'ambiguous',
      candidates: ['one-ext', 'two-ext'],
      searchedPaths: ['/tmp/profile'],
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'cli', 'dev', 'enable-inspect'])
    ).rejects.toThrow('Multiple Browser Bridge extension ids discovered.');
  });

  it('enable-inspect fails with actionable timeout details when inspect never comes up', async () => {
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async (path: string) => {
        if (path === '/diagnostics/enable_inspect') {
          return {
            ok: true as const,
            result: { ok: true, enabled: true, extension_id: 'flag-ext' },
          };
        }
        return {
          ok: true as const,
          result: inspectReport({
            inspectCapability: false,
            extensionConnected: true,
          }),
        };
      }),
    } as ReturnType<typeof createCoreClient>);

    process.env.BROWSER_BRIDGE_ENABLE_INSPECT_TIMEOUT_MS = '5';

    const program = buildProgram();
    await expect(
      program.parseAsync([
        'node',
        'cli',
        'dev',
        'enable-inspect',
        '--extension-id',
        'flag-ext',
      ])
    ).rejects.toThrow('Inspect capability did not come up before timeout.');

    delete process.env.BROWSER_BRIDGE_ENABLE_INSPECT_TIMEOUT_MS;
  });

  it('enable-inspect returns actionable fallback details when core cannot enable inspect directly', async () => {
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async (path: string) => {
        if (path === '/diagnostics/enable_inspect') {
          return {
            ok: false as const,
            error: {
              code: 'NOT_IMPLEMENTED',
              message: 'Extension does not advertise capability.',
              retryable: false,
            },
          };
        }
        return {
          ok: true as const,
          result: inspectReport({
            inspectCapability: false,
            extensionConnected: true,
          }),
        };
      }),
    } as ReturnType<typeof createCoreClient>);

    const program = buildProgram();
    await expect(
      program.parseAsync([
        'node',
        'cli',
        'dev',
        'enable-inspect',
        '--extension-id',
        'flag-ext',
      ])
    ).rejects.toThrow(
      'Inspect capability should already be enabled, but the connected extension did not confirm it.'
    );
  });
});
