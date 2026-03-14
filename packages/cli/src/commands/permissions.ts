import { Command } from 'commander';
import {
  PermissionsGetModeInputSchema,
  PermissionsListInputSchema,
  PermissionsListPendingRequestsInputSchema,
  PermissionsRequestAllowSiteInputSchema,
  PermissionsRequestRevokeSiteInputSchema,
  PermissionsRequestSetModeInputSchema,
} from '@btraut/browser-bridge-shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const registerPermissionsCommands = (program: Command): void => {
  const permissions = program
    .command('permissions')
    .description('Manage Browser Bridge permissions');

  permissions
    .command('list')
    .description('List allowlisted sites')
    .action(async (_options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(PermissionsListInputSchema, {});
        return client.post('/permissions/list', payload);
      });
    });

  permissions
    .command('mode')
    .description('Show the current permissions mode')
    .action(async (_options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(PermissionsGetModeInputSchema, {});
        return client.post('/permissions/get_mode', payload);
      });
    });

  permissions
    .command('pending')
    .description('List pending external permission-change requests')
    .action(async (_options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(
          PermissionsListPendingRequestsInputSchema,
          {}
        );
        return client.post('/permissions/list_pending_requests', payload);
      });
    });

  permissions
    .command('allow-site')
    .description('Request allowlisting a site')
    .requiredOption('--site <site>', 'Site hostname[:port] to allowlist')
    .option(
      '--timeout-ms <ms>',
      'How long to wait for approval before returning'
    )
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(PermissionsRequestAllowSiteInputSchema, {
          site: options.site,
          timeout_ms: parseNumber(options.timeoutMs),
          source: 'cli',
        });
        return client.post('/permissions/request_allow_site', payload);
      });
    });

  permissions
    .command('revoke-site')
    .description('Request revoking a site from the allowlist')
    .requiredOption('--site <site>', 'Site hostname[:port] to revoke')
    .option(
      '--timeout-ms <ms>',
      'How long to wait for approval before returning'
    )
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(PermissionsRequestRevokeSiteInputSchema, {
          site: options.site,
          timeout_ms: parseNumber(options.timeoutMs),
          source: 'cli',
        });
        return client.post('/permissions/request_revoke_site', payload);
      });
    });

  permissions
    .command('set-mode')
    .description('Request changing the permissions mode')
    .requiredOption('--mode <mode>', 'Mode to request (granular or bypass)')
    .option(
      '--timeout-ms <ms>',
      'How long to wait for approval before returning'
    )
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(PermissionsRequestSetModeInputSchema, {
          mode: options.mode,
          timeout_ms: parseNumber(options.timeoutMs),
          source: 'cli',
        });
        return client.post('/permissions/request_set_mode', payload);
      });
    });
};
