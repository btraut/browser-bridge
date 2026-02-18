import { Command } from 'commander';
import {
  DiagnosticsDoctorInputSchema,
  HealthCheckInputSchema,
} from '@btraut/browser-bridge-shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

export const registerDiagnosticsCommands = (program: Command): void => {
  const diagnostics = program
    .command('diagnostics')
    .description('Diagnostics commands');

  diagnostics
    .command('doctor')
    .description('Run diagnostics')
    .option('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DiagnosticsDoctorInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/diagnostics/doctor', payload);
      });
    });

  diagnostics
    .command('health-check')
    .description('Run a lightweight health check')
    .action(async (_options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(HealthCheckInputSchema, {});
        return client.post('/health/check', payload);
      });
    });
};
