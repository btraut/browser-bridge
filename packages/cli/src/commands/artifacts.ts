import { Command } from 'commander';
import { ArtifactsScreenshotInputSchema } from '@btraut/browser-bridge-shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const registerArtifactsCommands = (program: Command): void => {
  const artifacts = program
    .command('artifacts')
    .description('Artifact commands');

  artifacts
    .command('screenshot')
    .description('Request a screenshot artifact')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--target <target>', 'Screenshot target (viewport, full)')
    .option('--full-page', 'Capture full page (alias for --target full)')
    .option('--format <format>', 'Screenshot format (png, jpeg, webp)')
    .option('--quality <quality>', 'Screenshot quality (0-100) for jpeg/webp')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(ArtifactsScreenshotInputSchema, {
          session_id: options.sessionId,
          target: options.target,
          fullPage: Boolean(options.fullPage),
          format: options.format,
          quality: parseNumber(options.quality),
        });
        return client.post('/artifacts/screenshot', payload);
      });
    });
};
