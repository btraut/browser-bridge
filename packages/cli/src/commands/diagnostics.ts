import { Command } from 'commander';
import { DiagnosticsDoctorInputSchema } from '@btraut/browser-bridge-shared';
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
};
