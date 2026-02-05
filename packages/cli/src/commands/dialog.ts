import { Command } from 'commander';
import {
  DialogAcceptInputSchema,
  DialogDismissInputSchema,
} from '@browser-vision/shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

export const registerDialogCommands = (program: Command): void => {
  const dialog = program.command('dialog').description('Dialog commands');

  dialog
    .command('accept')
    .description('Accept a JavaScript dialog')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DialogAcceptInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/dialog/accept', payload);
      });
    });

  dialog
    .command('dismiss')
    .description('Dismiss a JavaScript dialog')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DialogDismissInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/dialog/dismiss', payload);
      });
    });
};
