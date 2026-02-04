import { Command } from 'commander';
import {
  SessionCloseInputSchema,
  SessionCreateInputSchema,
  SessionRecoverInputSchema,
  SessionStatusInputSchema,
} from '@browser-vision/shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

export const registerSessionCommands = (program: Command): void => {
  const session = program
    .command('session')
    .description('Manage Core sessions');

  session
    .command('create')
    .description('Create a new session')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(SessionCreateInputSchema, {});
        return client.post('/session/create', payload);
      });
    });

  session
    .command('status')
    .description('Get session status')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(SessionStatusInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/session/status', payload);
      });
    });

  session
    .command('recover')
    .description('Attempt to recover a session')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(SessionRecoverInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/session/recover', payload);
      });
    });

  session
    .command('close')
    .description('Close a session')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(SessionCloseInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/session/close', payload);
      });
    });
};
