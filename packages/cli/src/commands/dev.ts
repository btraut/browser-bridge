import { Command } from 'commander';
import {
  type DiagnosticReport,
  resolveCoreRuntime,
  resolveLogDirectory,
  type ResolvedCoreRuntime,
} from '@btraut/browser-bridge-shared';
import { CliError } from '../cli-output';
import { createCoreClient } from '../core-client';
import { runLocal } from '../cli-runtime';
import { openPath } from '../open-path';
import { discoverActivationExtensionId } from '../extension-id-discovery';

const ENV_EXTENSION_ID = 'BROWSER_BRIDGE_EXTENSION_ID';
const ENABLE_INSPECT_FLAG_PARAM = 'bb_enable_inspect';
const ENABLE_INSPECT_WAIT_TIMEOUT_MS = 30000;
const ENABLE_INSPECT_WAIT_INTERVAL_MS = 500;

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

export const buildEnableInspectOptionsUrl = (options: {
  extensionId: string;
}): string => {
  const search = new URLSearchParams();
  search.set(ENABLE_INSPECT_FLAG_PARAM, '1');
  return `chrome-extension://${
    options.extensionId
  }/options.html?${search.toString()}`;
};

const resolveRuntimeForCommand = (
  options: {
    host?: string;
    port?: number | string;
  }
): ResolvedCoreRuntime => {
  const runtimeOptions: {
    host?: string;
    port?: number | string;
    strictEnvPort: boolean;
  } = {
    host: options.host,
    port: options.port,
    strictEnvPort: true,
  };
  return resolveCoreRuntime(runtimeOptions);
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveEnableInspectWaitTimeoutMs = (): number => {
  const raw =
    process.env.BROWSER_BRIDGE_ENABLE_INSPECT_TIMEOUT_MS ??
    process.env.BROWSER_BRIDGE_ACTIVATE_TIMEOUT_MS;
  if (!raw) {
    return ENABLE_INSPECT_WAIT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ENABLE_INSPECT_WAIT_TIMEOUT_MS;
  }
  return parsed;
};

const hasPassingCheck = (
  report: DiagnosticReport | undefined,
  name: string
): boolean =>
  report?.checks?.some((check) => check.name === name && check.ok) ?? false;

const waitForInspectEnablement = async (
  runtime: ResolvedCoreRuntime,
  expectedExtensionId: string,
  optionsUrl: string
): Promise<void> => {
  const timeoutMs = resolveEnableInspectWaitTimeoutMs();
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
    const runtimeExtensionId = lastReport?.runtime?.extension?.extension_id;
    const extensionIdMatch =
      !runtimeExtensionId || runtimeExtensionId === expectedExtensionId;
    const inspectCapability = hasPassingCheck(lastReport, 'inspect.capability');

    if (extensionConnected && extensionIdMatch && inspectCapability) {
      return;
    }

    await sleep(ENABLE_INSPECT_WAIT_INTERVAL_MS);
  }

  throw new CliError({
    code: 'FAILED_PRECONDITION',
    message:
      'Inspect enablement did not complete: extension did not report debugger capability before timeout.',
    retryable: true,
    details: {
      timeoutMs,
      host: runtime.host,
      port: runtime.port,
      expectedExtensionId,
      observedConnected: lastReport?.extension?.connected ?? false,
      observedExtensionId: lastReport?.runtime?.extension?.extension_id,
      observedInspectCapability: hasPassingCheck(
        lastReport,
        'inspect.capability'
      ),
      optionsUrl,
    },
  });
};

export const registerDevCommands = (program: Command): void => {
  const dev = program.command('dev').description('Development commands');

  dev
    .command('info')
    .description('Print resolved runtime details for the current environment')
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
            metadataPath: runtime.metadataPath,
            logDir,
            metadataSnapshot: runtime.metadata,
          },
        };
      });
    });

  dev
    .command('enable-inspect')
    .description(
      'Open extension options and enable debugger-based inspect capability'
    )
    .option(
      '--extension-id <id>',
      'Chrome extension id to configure for debugger-based inspect'
    )
    .action(
      async (options: { extensionId?: string }, command: Command) => {
        await runLocal(command, async (globalOptions) => {
          const runtime = resolveRuntimeForCommand(globalOptions);
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
            discoveryResult = await discoverActivationExtensionId([runtime]);
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
                'Missing extension id. Provide --extension-id <id> or set BROWSER_BRIDGE_EXTENSION_ID.',
              retryable: false,
              details: {
                searchedPaths:
                  discoveryResult && discoveryResult.kind !== 'resolved'
                    ? discoveryResult.searchedPaths
                    : undefined,
              },
            });
          }

          const optionsUrl = buildEnableInspectOptionsUrl({
            extensionId: resolvedExtension.extensionId,
          });

          await openPath(optionsUrl);
          await waitForInspectEnablement(
            runtime,
            resolvedExtension.extensionId,
            optionsUrl
          );

          return {
            ok: true,
            result: {
              extensionId: resolvedExtension.extensionId,
              extensionIdSource: resolvedExtension.source,
              host: runtime.host,
              port: runtime.port,
              optionsUrl,
            },
          };
        });
      }
    );
};
