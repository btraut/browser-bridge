import { Command } from 'commander';
import {
  resolveCoreRuntime,
  resolveLogDirectory,
  writeRuntimeMetadata,
  type ResolvedCoreRuntime,
  type RuntimeMetadata,
} from '@btraut/browser-bridge-shared';
import { CliError } from '../cli-output';
import { runLocal } from '../cli-runtime';
import { openPath } from '../open-path';
import { discoverActivationExtensionId } from '../extension-id-discovery';

const ENV_EXTENSION_ID = 'BROWSER_BRIDGE_EXTENSION_ID';
const ACTIVATION_FLAG_PARAM = 'bb_activate';
const ACTIVATION_PORT_PARAM = 'corePort';
const ACTIVATION_WORKTREE_PARAM = 'worktreeId';

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
}): string => {
  const search = new URLSearchParams();
  search.set(ACTIVATION_FLAG_PARAM, '1');
  search.set(ACTIVATION_PORT_PARAM, String(options.corePort));
  if (options.worktreeId) {
    search.set(ACTIVATION_WORKTREE_PARAM, options.worktreeId);
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
    .action(async (options: { extensionId?: string }, command: Command) => {
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
          discoveryResult = await discoverActivationExtensionId(sharedRuntime);
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
          buildPersistedRuntimeMetadata(runtime, resolvedExtension.extensionId),
          { metadataPath: runtime.metadataPath }
        );
        const activationUrl = buildActivationOptionsUrl({
          extensionId: resolvedExtension.extensionId,
          corePort: runtime.port,
          worktreeId: runtime.worktreeId,
        });

        await openPath(activationUrl);

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
          },
        };
      });
    });
};
