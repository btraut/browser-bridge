import { Command } from 'commander';
import {
  type DiagnosticReport,
  resolveCoreRuntime,
  resolveLogDirectory,
  writeRuntimeMetadata,
  type ResolvedCoreRuntime,
  type RuntimeMetadata,
} from '@btraut/browser-bridge-shared';
import { CliError } from '../cli-output';
import { createCoreClient } from '../core-client';
import { runLocal } from '../cli-runtime';
import { openPath } from '../open-path';
import { discoverActivationExtensionId } from '../extension-id-discovery';

const ENV_EXTENSION_ID = 'BROWSER_BRIDGE_EXTENSION_ID';
const ACTIVATION_FLAG_PARAM = 'bb_activate';
const ACTIVATION_PORT_PARAM = 'corePort';
const ACTIVATION_WORKTREE_PARAM = 'worktreeId';
const ACTIVATION_ENABLE_INSPECT_PARAM = 'enableInspect';
const ACTIVATION_WAIT_TIMEOUT_MS = 30000;
const ACTIVATION_WAIT_INTERVAL_MS = 500;

type ExtensionIdSource = 'flag' | 'env' | 'metadata' | 'connected' | 'profile';

type ResolvedExtensionId = {
  extensionId: string;
  source: ExtensionIdSource;
};

const normalizeToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveActivationExtensionId = (options: {
  optionExtensionId?: string;
  envExtensionId?: string;
  metadataExtensionId?: string;
}): ResolvedExtensionId | null => {
  const optionId = normalizeToken(options.optionExtensionId);
  if (optionId) {
    return { extensionId: optionId, source: 'flag' };
  }

  const envId = normalizeToken(options.envExtensionId);
  if (envId) {
    return { extensionId: envId, source: 'env' };
  }

  const metadataId = normalizeToken(options.metadataExtensionId);
  if (metadataId) {
    return { extensionId: metadataId, source: 'metadata' };
  }

  return null;
};

export const buildActivationOptionsUrl = (options: {
  extensionId: string;
  corePort: number;
  worktreeId: string | null;
  enableInspect?: boolean;
}): string => {
  const search = new URLSearchParams();
  search.set(ACTIVATION_FLAG_PARAM, '1');
  search.set(ACTIVATION_PORT_PARAM, String(options.corePort));
  if (options.worktreeId) {
    search.set(ACTIVATION_WORKTREE_PARAM, options.worktreeId);
  }
  if (options.enableInspect) {
    search.set(ACTIVATION_ENABLE_INSPECT_PARAM, '1');
  }
  return `chrome-extension://${
    options.extensionId
  }/options.html?${search.toString()}`;
};

const buildPersistedRuntimeMetadata = (
  runtime: ResolvedCoreRuntime,
  extensionId: string
): RuntimeMetadata => ({
  ...(runtime.metadata ?? {}),
  host: runtime.host,
  port: runtime.port,
  git_root: runtime.gitRoot ?? runtime.metadata?.git_root,
  worktree_id: runtime.worktreeId ?? runtime.metadata?.worktree_id,
  extension_id: extensionId,
  isolated_mode: true,
  updated_at: new Date().toISOString(),
});

const resolveRuntimeForCommand = (
  options: {
    host?: string;
    port?: number | string;
  },
  overrides: {
    isolatedMode?: boolean;
  } = {}
): ResolvedCoreRuntime => {
  const runtimeOptions: {
    host?: string;
    port?: number | string;
    isolatedMode?: boolean;
    strictEnvPort: boolean;
  } = {
    host: options.host,
    port: options.port,
    strictEnvPort: true,
  };
  if (overrides.isolatedMode !== undefined) {
    runtimeOptions.isolatedMode = overrides.isolatedMode;
  }
  return resolveCoreRuntime(runtimeOptions);
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveActivationWaitTimeoutMs = (): number => {
  const raw = process.env.BROWSER_BRIDGE_ACTIVATE_TIMEOUT_MS;
  if (!raw) {
    return ACTIVATION_WAIT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ACTIVATION_WAIT_TIMEOUT_MS;
  }
  return parsed;
};

const hasPassingCheck = (
  report: DiagnosticReport | undefined,
  name: string
): boolean =>
  report?.checks?.some((check) => check.name === name && check.ok) ?? false;

const waitForIsolatedActivation = async (
  runtime: ResolvedCoreRuntime,
  expectedExtensionId: string,
  activationUrl: string,
  options: {
    requireInspectCapability?: boolean;
  } = {}
): Promise<void> => {
  const requireInspectCapability = options.requireInspectCapability ?? false;
  const timeoutMs = resolveActivationWaitTimeoutMs();
  const client = createCoreClient({
    host: runtime.host,
    port: runtime.port,
    ensureDaemon: true,
  });
  const deadline = Date.now() + timeoutMs;
  let lastReport: DiagnosticReport | undefined;

  while (Date.now() <= deadline) {
    try {
      const envelope = await client.post<DiagnosticReport>(
        '/diagnostics/doctor',
        {}
      );
      if (envelope.ok && envelope.result) {
        lastReport = envelope.result;
      }
    } catch {
      // ignore transient health failures while activation is in progress
    }

    const extensionConnected = lastReport?.extension?.connected === true;
    const endpointMatch = hasPassingCheck(
      lastReport,
      'runtime.extension.endpoint_match'
    );
    const runtimeExtensionId = lastReport?.runtime?.extension?.extension_id;
    const extensionIdMatch =
      !runtimeExtensionId || runtimeExtensionId === expectedExtensionId;
    const inspectCapability = hasPassingCheck(lastReport, 'inspect.capability');

    if (
      extensionConnected &&
      endpointMatch &&
      extensionIdMatch &&
      (!requireInspectCapability || inspectCapability)
    ) {
      return;
    }

    await sleep(ACTIVATION_WAIT_INTERVAL_MS);
  }

  throw new CliError({
    code: 'FAILED_PRECONDITION',
    message:
      'Isolated activation did not complete: extension did not bind to the isolated runtime before timeout.',
    retryable: true,
    details: {
      timeoutMs,
      host: runtime.host,
      port: runtime.port,
      expectedExtensionId,
      observedConnected: lastReport?.extension?.connected ?? false,
      observedExtensionId: lastReport?.runtime?.extension?.extension_id,
      observedEndpoint: lastReport?.runtime?.extension?.endpoint?.base_url,
      requiredInspectCapability: requireInspectCapability,
      observedInspectCapability: hasPassingCheck(
        lastReport,
        'inspect.capability'
      ),
      activationUrl,
    },
  });
};

export const registerDevCommands = (program: Command): void => {
  const dev = program.command('dev').description('Development commands');

  dev
    .command('info')
    .description('Print resolved runtime details for the current worktree')
    .action(async (_options, command: Command) => {
      await runLocal(command, async (globalOptions) => {
        const runtime = resolveRuntimeForCommand(globalOptions);
        const logDir = resolveLogDirectory({ gitRoot: runtime.gitRoot });
        return {
          ok: true,
          result: {
            host: runtime.host,
            hostSource: runtime.hostSource,
            port: runtime.port,
            portSource: runtime.portSource,
            deterministicPort: runtime.deterministicPort,
            worktreeId: runtime.worktreeId,
            metadataPath: runtime.metadataPath,
            logDir,
            metadataSnapshot: runtime.metadata,
          },
        };
      });
    });

  dev
    .command('activate')
    .description(
      'Enable isolated worktree routing and open extension options for activation'
    )
    .option(
      '--extension-id <id>',
      'Chrome extension id to activate for isolated worktree routing'
    )
    .option(
      '--enable-inspect',
      'Enable debugger-based inspect capability in extension options during activation'
    )
    .action(
      async (
        options: { extensionId?: string; enableInspect?: boolean },
        command: Command
      ) => {
        await runLocal(command, async (globalOptions) => {
          const runtime = resolveRuntimeForCommand(globalOptions, {
            isolatedMode: true,
          });
          const extension = resolveActivationExtensionId({
            optionExtensionId: options.extensionId,
            envExtensionId: process.env[ENV_EXTENSION_ID],
            metadataExtensionId: runtime.metadata?.extension_id,
          });
          let resolvedExtension = extension;
          let discoveryResult:
            | Awaited<ReturnType<typeof discoverActivationExtensionId>>
            | undefined;
          if (!resolvedExtension) {
            const sharedRuntime = resolveRuntimeForCommand(globalOptions, {
              isolatedMode: false,
            });
            discoveryResult =
              await discoverActivationExtensionId(sharedRuntime);
            if (discoveryResult.kind === 'resolved') {
              resolvedExtension = {
                extensionId: discoveryResult.extensionId,
                source: discoveryResult.source,
              };
            } else if (discoveryResult.kind === 'ambiguous') {
              throw new CliError({
                code: 'INVALID_ARGUMENT',
                message:
                  'Multiple Browser Bridge extension ids discovered. Provide --extension-id <id> to select one.',
                retryable: false,
                details: {
                  candidates: discoveryResult.candidates,
                  searchedPaths: discoveryResult.searchedPaths,
                },
              });
            }
          }

          if (!resolvedExtension) {
            throw new CliError({
              code: 'INVALID_ARGUMENT',
              message:
                'Missing extension id. Provide --extension-id <id>, set BROWSER_BRIDGE_EXTENSION_ID, or persist extension_id in metadata by running dev activate with --extension-id once (only needed for isolated worktree routing).',
              retryable: false,
              details: {
                metadataPath: runtime.metadataPath,
                searchedPaths:
                  discoveryResult && discoveryResult.kind !== 'resolved'
                    ? discoveryResult.searchedPaths
                    : undefined,
              },
            });
          }

          const metadataPath = writeRuntimeMetadata(
            buildPersistedRuntimeMetadata(
              runtime,
              resolvedExtension.extensionId
            ),
            { metadataPath: runtime.metadataPath }
          );
          const activationUrl = buildActivationOptionsUrl({
            extensionId: resolvedExtension.extensionId,
            corePort: runtime.port,
            worktreeId: runtime.worktreeId,
            enableInspect: options.enableInspect,
          });

          await openPath(activationUrl);
          await waitForIsolatedActivation(
            runtime,
            resolvedExtension.extensionId,
            activationUrl,
            { requireInspectCapability: options.enableInspect === true }
          );

          return {
            ok: true,
            result: {
              extensionId: resolvedExtension.extensionId,
              extensionIdSource: resolvedExtension.source,
              host: runtime.host,
              port: runtime.port,
              isolatedMode: true,
              metadataPath,
              activationUrl,
              inspectEnabledRequested: options.enableInspect === true,
            },
          };
        });
      }
    );
};
