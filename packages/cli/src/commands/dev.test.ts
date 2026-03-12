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
import { CoreClientError, createCoreClient } from '../core-client';
import { registerDevCommands, resolveActivationExtensionId } from './dev';

vi.mock('../cli-runtime', () => ({
  runLocal: vi.fn(),
}));

vi.mock('../core-client', async () => {
  const actual =
    await vi.importActual<typeof import('../core-client')>('../core-client');
  return {
    ...actual,
    createCoreClient: vi.fn(),
  };
});

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
  it('resolves extension id precedence flag > env', () => {
    expect(
      resolveActivationExtensionId({
        optionExtensionId: 'flag-ext',
        envExtensionId: 'env-ext',
      })
    ).toEqual({ extensionId: 'flag-ext', source: 'flag' });

    expect(
      resolveActivationExtensionId({
        envExtensionId: 'env-ext',
      })
    ).toEqual({ extensionId: 'env-ext', source: 'env' });
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
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      await work({ json: false });
    });
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async () => ({
        ok: true as const,
        result: inspectReport({
          inspectCapability: true,
          extensionId: 'connected-ext',
        }),
      })),
    } as ReturnType<typeof createCoreClient>);
  });

  afterEach(() => {
    delete process.env.BROWSER_BRIDGE_EXTENSION_ID;
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

  it('enable-inspect verifies inspect through diagnostics and returns the connected extension id', async () => {
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
      'connected-ext',
    ]);

    expect(createCoreClient).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 3210,
      ensureDaemon: true,
    });
    const client = vi.mocked(createCoreClient).mock.results[0]
      ?.value as ReturnType<typeof createCoreClient>;
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenNthCalledWith(1, '/diagnostics/doctor', {});
    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'connected-ext',
        extensionIdSource: 'flag',
        checkedWithDiagnostics: true,
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
      post: vi.fn(async () => ({
        ok: true as const,
        result: inspectReport({
          inspectCapability: true,
          extensionId: 'env-ext',
        }),
      })),
    } as ReturnType<typeof createCoreClient>);

    let envelope: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      envelope = await work({ json: false });
    });

    const program = buildProgram();
    await program.parseAsync(['node', 'cli', 'dev', 'enable-inspect']);

    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'env-ext',
        extensionIdSource: 'env',
        checkedWithDiagnostics: true,
        host: '127.0.0.1',
        port: 3210,
        inspectAlwaysEnabled: true,
      },
    });
  });

  it('enable-inspect falls back to the reported connected extension when no explicit source is set', async () => {
    let envelope: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      envelope = await work({ json: false });
    });

    const program = buildProgram();
    await program.parseAsync(['node', 'cli', 'dev', 'enable-inspect']);

    expect(envelope).toEqual({
      ok: true,
      result: {
        extensionId: 'connected-ext',
        extensionIdSource: 'connected',
        checkedWithDiagnostics: true,
        host: '127.0.0.1',
        port: 3210,
        inspectAlwaysEnabled: true,
      },
    });
  });

  it('enable-inspect fails when the connected extension does not match the requested extension id', async () => {
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
      'Inspect capability is available, but the connected extension does not match the requested extension id.'
    );
  });

  it('enable-inspect fails with actionable details when inspect capability is unavailable', async () => {
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async () => ({
        ok: true as const,
        result: inspectReport({
          inspectCapability: false,
          extensionConnected: true,
          extensionId: 'connected-ext',
        }),
      })),
    } as ReturnType<typeof createCoreClient>);

    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'cli', 'dev', 'enable-inspect'])
    ).rejects.toThrow(
      'Inspect capability is unavailable in a build where it should already be enabled.'
    );
  });

  it('enable-inspect surfaces structured transport errors from non-json core responses', async () => {
    vi.mocked(createCoreClient).mockReturnValue({
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: vi.fn(async () => {}),
      post: vi.fn(async () => {
        throw new CoreClientError({
          code: 'UNAVAILABLE',
          message: 'Core returned HTML instead of JSON.',
          retryable: true,
          details: {
            path: '/diagnostics/doctor',
            reason: 'core_invalid_json_response',
            next_step:
              'Verify Browser Bridge core is reachable on the expected host and port, then retry.',
          },
        });
      }),
    } as ReturnType<typeof createCoreClient>);

    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'cli', 'dev', 'enable-inspect'])
    ).rejects.toThrow('Core returned HTML instead of JSON.');
  });
});
