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

const ENV_EXTENSION_ID = 'BROWSER_BRIDGE_EXTENSION_ID';

type ExtensionIdSource = 'flag' | 'env' | 'connected';

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
}): ResolvedExtensionId | null => {
  const optionId = normalizeToken(options.optionExtensionId);
  if (optionId) {
    return { extensionId: optionId, source: 'flag' };
  }

  const envId = normalizeToken(options.envExtensionId);
  if (envId) {
    return { extensionId: envId, source: 'env' };
  }

  return null;
};

const resolveRuntimeForCommand = (options: {
  host?: string;
  port?: number | string;
}): ResolvedCoreRuntime => {
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

const hasPassingCheck = (
  report: DiagnosticReport | undefined,
  name: string
): boolean =>
  report?.checks?.some((check) => check.name === name && check.ok) ?? false;

const getReportedExtensionId = (
  report: DiagnosticReport | undefined
): string | undefined =>
  normalizeToken(report?.runtime?.extension?.extension_id);

const inspectCapabilityReady = (
  report: DiagnosticReport | undefined,
  expectedExtensionId?: string
): boolean => {
  const reportedExtensionId = getReportedExtensionId(report);
  const extensionIdMatch =
    !expectedExtensionId ||
    !reportedExtensionId ||
    reportedExtensionId === expectedExtensionId;
  return extensionIdMatch && hasPassingCheck(report, 'inspect.capability');
};

const readDiagnosticReport = async (
  runtime: ResolvedCoreRuntime
): Promise<DiagnosticReport | undefined> => {
  const client = createCoreClient({
    host: runtime.host,
    port: runtime.port,
    ensureDaemon: true,
  });
  const envelope = await client.post<DiagnosticReport>(
    '/diagnostics/doctor',
    {}
  );
  return envelope.ok ? envelope.result : undefined;
};

const buildInspectCapabilityError = (
  runtime: ResolvedCoreRuntime,
  report: DiagnosticReport | undefined,
  expectedExtension?: ResolvedExtensionId | null
): CliError => {
  const observedExtensionId = getReportedExtensionId(report);
  if (
    expectedExtension &&
    observedExtensionId &&
    observedExtensionId !== expectedExtension.extensionId
  ) {
    return new CliError({
      code: 'FAILED_PRECONDITION',
      message:
        'Inspect capability is available, but the connected extension does not match the requested extension id.',
      retryable: false,
      details: {
        host: runtime.host,
        port: runtime.port,
        expectedExtensionId: expectedExtension.extensionId,
        expectedExtensionIdSource: expectedExtension.source,
        observedExtensionId,
        next_step:
          'Clear the stale extension-id override or reload the intended Browser Bridge extension, then retry.',
      },
    });
  }

  return new CliError({
    code: 'FAILED_PRECONDITION',
    message:
      'Inspect capability is unavailable in a build where it should already be enabled.',
    retryable: true,
    details: {
      host: runtime.host,
      port: runtime.port,
      expectedExtensionId: expectedExtension?.extensionId,
      expectedExtensionIdSource: expectedExtension?.source,
      observedConnected: report?.extension?.connected ?? false,
      observedExtensionId,
      observedInspectCapability: hasPassingCheck(report, 'inspect.capability'),
      next_step:
        'Restart the Browser Bridge core daemon, then reload or update the Browser Bridge extension and retry.',
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
    .description('Compatibility helper that verifies inspect capability')
    .option(
      '--extension-id <id>',
      'Chrome extension id to verify against while checking inspect capability'
    )
    .action(async (options: { extensionId?: string }, command: Command) => {
      await runLocal(command, async (globalOptions) => {
        const runtime = resolveRuntimeForCommand(globalOptions);
        let resolvedExtension = resolveActivationExtensionId({
          optionExtensionId: options.extensionId,
          envExtensionId: process.env[ENV_EXTENSION_ID],
        });
        const report = await readDiagnosticReport(runtime);

        if (!resolvedExtension) {
          const reportedExtensionId = getReportedExtensionId(report);
          if (reportedExtensionId) {
            resolvedExtension = {
              extensionId: reportedExtensionId,
              source: 'connected',
            };
          }
        }

        if (!inspectCapabilityReady(report, resolvedExtension?.extensionId)) {
          throw buildInspectCapabilityError(runtime, report, resolvedExtension);
        }

        return {
          ok: true,
          result: {
            host: runtime.host,
            port: runtime.port,
            inspectAlwaysEnabled: true,
            checkedWithDiagnostics: true,
            ...(resolvedExtension
              ? {
                  extensionId: resolvedExtension.extensionId,
                  extensionIdSource: resolvedExtension.source,
                }
              : {}),
          },
        };
      });
    });
};
