import { Command } from 'commander';
import {
  DialogAcceptInputSchema,
  DialogDismissInputSchema,
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

export const registerDialogCommands = (program: Command): void => {
  const dialog = program.command('dialog').description('Dialog commands');

  dialog
    .command('accept')
    .description('Accept a JavaScript dialog')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--prompt-text <text>', 'Prompt text for prompt() dialogs')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DialogAcceptInputSchema, {
          session_id: options.sessionId,
          promptText: options.promptText,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/dialog/accept', payload);
      });
    });

  dialog
    .command('dismiss')
    .description('Dismiss a JavaScript dialog')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DialogDismissInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/dialog/dismiss', payload);
      });
    });
};
