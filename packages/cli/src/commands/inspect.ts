import { Command } from 'commander';
import {
  InspectConsoleListInputSchema,
  InspectDomDiffInputSchema,
  InspectDomSnapshotInputSchema,
  InspectExtractContentInputSchema,
  InspectEvaluateInputSchema,
  InspectFindInputSchema,
  InspectNetworkHarInputSchema,
  InspectPageStateInputSchema,
  InspectPerformanceMetricsInputSchema,
} from '@btraut/browser-bridge-shared';
import { CliError, parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const buildTargetHint = (options: { tabId?: unknown }) => {
  const tabId = parseNumber(options.tabId);
  if (tabId === undefined) {
    return undefined;
  }
  return { tab_id: tabId };
};

export const registerInspectCommands = (program: Command): void => {
  const inspect = program.command('inspect').description('Inspect commands');

  inspect
    .command('dom-snapshot')
    .description('Fetch a DOM snapshot')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--format <format>', 'Snapshot format (ax, html)')
    .option('--consistency <mode>', 'Consistency mode (best_effort, quiesce)')
    .option('-i, --interactive', 'Only include interactive elements')
    .option('-c, --compact', 'Remove empty/decorative nodes')
    .option('--max-nodes <n>', 'Limit AX snapshot to at most n nodes')
    .option('-s, --selector <selector>', 'Limit snapshot to selector')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectDomSnapshotInputSchema, {
          session_id: options.sessionId,
          format: options.format,
          consistency: options.consistency,
          interactive: options.interactive,
          compact: options.compact,
          max_nodes: options.maxNodes,
          selector: options.selector,
          target: buildTargetHint(options),
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
    .command('find')
    .description('Find elements and return refs')
    .requiredOption('--session-id <id>', 'Session identifier')
    .argument('<kind>', 'Find kind (role, text, label)')
    .argument('<value>', 'Role name or text to match')
    .option('--name <name>', 'Accessible name to match (role only)')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (kind, value, options, command) => {
      await runCommand(command, (client) => {
        const normalizedKind = String(kind ?? '').toLowerCase();
        let payload: unknown;
        if (normalizedKind === 'role') {
          payload = {
            session_id: options.sessionId,
            kind: 'role',
            role: value,
            name: options.name,
            target: buildTargetHint(options),
          };
        } else if (normalizedKind === 'text') {
          payload = {
            session_id: options.sessionId,
            kind: 'text',
            text: value,
            target: buildTargetHint(options),
          };
        } else if (normalizedKind === 'label') {
          payload = {
            session_id: options.sessionId,
            kind: 'label',
            label: value,
            target: buildTargetHint(options),
          };
        } else {
          throw new CliError({
            code: 'INVALID_ARGUMENT',
            message: 'kind must be role, text, or label.',
            retryable: false,
            details: { field: 'kind' },
          });
        }
        const parsed = parseInput(InspectFindInputSchema, payload);
        return client.post('/inspect/find', parsed);
      });
    });

  inspect
    .command('extract-content')
    .description('Extract main content from the page')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--format <format>', 'Output format (markdown, text, article_json)')
    .option(
      '--consistency <mode>',
      'Capture consistency (best_effort, quiesce)'
    )
    .option('--include-metadata', 'Include article metadata')
    .option('--no-include-metadata', 'Exclude article metadata')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectExtractContentInputSchema, {
          session_id: options.sessionId,
          format: options.format,
          consistency: options.consistency,
          include_metadata: options.includeMetadata,
          target: buildTargetHint(options),
        });
        return client.post('/inspect/extract_content', payload);
      });
    });

  inspect
    .command('page-state')
    .description('Capture form, storage, and cookie state')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--include-values', 'Include captured values instead of redacting')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectPageStateInputSchema, {
          session_id: options.sessionId,
          include_values: options.includeValues,
          target: buildTargetHint(options),
        });
        return client.post('/inspect/page_state', payload);
      });
    });

  inspect
    .command('console-list')
    .description('Fetch console entries')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--since <iso>', 'Only include entries at or after this timestamp')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectConsoleListInputSchema, {
          session_id: options.sessionId,
          since: options.since,
          target: buildTargetHint(options),
        });
        return client.post('/inspect/console_list', payload);
      });
    });

  inspect
    .command('network-har')
    .description('Fetch network HAR')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectNetworkHarInputSchema, {
          session_id: options.sessionId,
          target: buildTargetHint(options),
        });
        return client.post('/inspect/network_har', payload);
      });
    });

  inspect
    .command('evaluate')
    .description('Evaluate a JavaScript expression')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--expression <expr>', 'Expression to evaluate')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectEvaluateInputSchema, {
          session_id: options.sessionId,
          expression: options.expression,
          target: buildTargetHint(options),
        });
        return client.post('/inspect/evaluate', payload);
      });
    });

  inspect
    .command('performance-metrics')
    .description('Fetch performance metrics')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Explicit tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectPerformanceMetricsInputSchema, {
          session_id: options.sessionId,
          target: buildTargetHint(options),
        });
        return client.post('/inspect/performance_metrics', payload);
      });
    });
};
