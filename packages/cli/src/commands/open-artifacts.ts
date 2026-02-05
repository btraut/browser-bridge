import { Command } from 'commander';
import { ensureArtifactRootDir } from '@btraut/browser-bridge-core';
import { SessionIdSchema } from '@btraut/browser-bridge-shared';
import { parseInput } from '../cli-output';
import { runLocal } from '../cli-runtime';
import { openPath } from '../open-path';

export const registerOpenArtifactsCommand = (program: Command): void => {
  program
    .command('open-artifacts')
    .description('Open the artifact folder for a session')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runLocal(command, async () => {
        const payload = parseInput(SessionIdSchema, {
          session_id: options.sessionId,
        });
        const rootDir = await ensureArtifactRootDir(payload.session_id);
        await openPath(rootDir);
        return { ok: true, result: { path: rootDir, opened: true } };
      });
    });
};
