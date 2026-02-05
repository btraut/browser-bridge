import { Command } from 'commander';
import {
  InspectConsoleListInputSchema,
  InspectDomDiffInputSchema,
  InspectDomSnapshotInputSchema,
  InspectExtractContentInputSchema,
  InspectEvaluateInputSchema,
  InspectNetworkHarInputSchema,
  InspectPageStateInputSchema,
  InspectPerformanceMetricsInputSchema,
} from '@browser-vision/shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

export const registerInspectCommands = (program: Command): void => {
  const inspect = program.command('inspect').description('Inspect commands');

  inspect
    .command('dom-snapshot')
    .description('Fetch a DOM snapshot')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--format <format>', 'Snapshot format (ax, html)')
    .option('--consistency <mode>', 'Consistency mode (best_effort, quiesce)')
    .option('-i, --interactive', 'Only include interactive elements')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectDomSnapshotInputSchema, {
          session_id: options.sessionId,
          format: options.format,
          consistency: options.consistency,
          interactive: options.interactive,
        });
        return client.post('/inspect/dom_snapshot', payload);
      });
    });

  inspect
    .command('dom-diff')
    .description('Compare recent DOM snapshots')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectDomDiffInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/inspect/dom_diff', payload);
      });
    });

  inspect
    .command('extract-content')
    .description('Extract main content from the page')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--format <format>', 'Output format (markdown, text, article_json)')
    .option('--include-metadata', 'Include article metadata')
    .option('--no-include-metadata', 'Exclude article metadata')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectExtractContentInputSchema, {
          session_id: options.sessionId,
          format: options.format,
          include_metadata: options.includeMetadata,
        });
        return client.post('/inspect/extract_content', payload);
      });
    });

  inspect
    .command('page-state')
    .description('Capture form, storage, and cookie state')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectPageStateInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/inspect/page_state', payload);
      });
    });

  inspect
    .command('console-list')
    .description('Fetch console entries')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectConsoleListInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/inspect/console_list', payload);
      });
    });

  inspect
    .command('network-har')
    .description('Fetch network HAR')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectNetworkHarInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/inspect/network_har', payload);
      });
    });

  inspect
    .command('evaluate')
    .description('Evaluate a JavaScript expression')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--expression <expr>', 'Expression to evaluate')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectEvaluateInputSchema, {
          session_id: options.sessionId,
          expression: options.expression,
        });
        return client.post('/inspect/evaluate', payload);
      });
    });

  inspect
    .command('performance-metrics')
    .description('Fetch performance metrics')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectPerformanceMetricsInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/inspect/performance_metrics', payload);
      });
    });
};
