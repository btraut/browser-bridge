import { Command } from 'commander';
import {
  type ApiEnvelope,
  DialogAcceptInputSchema,
  DialogDismissInputSchema,
  DriveHandleDialogInputSchema,
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

const addDeprecatedDialogAliasWarning = <T>(
  envelope: ApiEnvelope<T>,
  aliasName: 'dialog.accept' | 'dialog.dismiss'
): ApiEnvelope<T> => {
  if (!envelope.ok || typeof envelope.result !== 'object' || !envelope.result) {
    return envelope;
  }
  const warning = `${aliasName} is deprecated; use drive.handle_dialog.`;
  const result = envelope.result as Record<string, unknown>;
  const existingWarnings = Array.isArray(result.warnings)
    ? result.warnings.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    ok: true,
    result: {
      ...result,
      warnings: existingWarnings.includes(warning)
        ? existingWarnings
        : [...existingWarnings, warning],
    } as T,
  };
};

export const registerDialogCommands = (program: Command): void => {
  const dialog = program.command('dialog').description('Dialog commands');

  dialog
    .command('accept')
    .description('Deprecated alias for drive handle-dialog --action accept')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--prompt-text <text>', 'Prompt text for prompt() dialogs')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const aliasPayload = parseInput(DialogAcceptInputSchema, {
          session_id: options.sessionId,
          promptText: options.promptText,
          tab_id: parseNumber(options.tabId),
        });
        const payload = parseInput(DriveHandleDialogInputSchema, {
          ...aliasPayload,
          action: 'accept',
        });
        return client
          .post('/drive/handle_dialog', payload)
          .then((envelope) =>
            addDeprecatedDialogAliasWarning(envelope, 'dialog.accept')
          );
      });
    });

  dialog
    .command('dismiss')
    .description('Deprecated alias for drive handle-dialog --action dismiss')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const aliasPayload = parseInput(DialogDismissInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        const payload = parseInput(DriveHandleDialogInputSchema, {
          ...aliasPayload,
          action: 'dismiss',
        });
        return client
          .post('/drive/handle_dialog', payload)
          .then((envelope) =>
            addDeprecatedDialogAliasWarning(envelope, 'dialog.dismiss')
          );
      });
    });
};
