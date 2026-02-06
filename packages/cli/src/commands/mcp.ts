import { Command } from 'commander';
import { startMcpServer } from '@btraut/browser-bridge-mcp-adapter';
import { createCoreClient } from '../core-client';
import { getGlobalOptions, runLocal } from '../cli-runtime';
import { checkboxPrompt, requireTty } from '../tui';
import { installMcp } from '../installer/mcp-install';

type McpCommandOptions = {
  name?: string;
  version?: string;
};

export const registerMcpCommand = (program: Command): void => {
  const startServer = async (
    options: McpCommandOptions,
    command: Command
  ): Promise<void> => {
    const globals = getGlobalOptions(command);
    const coreClient = createCoreClient({
      host: globals.host,
      port: globals.port,
      ensureDaemon: globals.daemon !== false,
    });

    try {
      await startMcpServer({
        name: options.name,
        version: options.version,
        coreClient,
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };

  const mcp = program.command('mcp').description('MCP server and helpers');

  mcp
    .command('install')
    .description('Install Browser Bridge as an MCP server in supported clients')
    .action(async (_options, command: Command) => {
      await runLocal(command, async ({ json }) => {
        if (json) {
          throw new Error('mcp install is interactive; omit --json.');
        }

        requireTty();

        const selected = await checkboxPrompt<'codex' | 'claude' | 'cursor'>({
          message: 'Install MCP into clients:',
          choices: [
            { value: 'codex', label: 'Codex', checked: true },
            { value: 'claude', label: 'Claude', checked: true },
            { value: 'cursor', label: 'Cursor', checked: true },
          ],
        });

        const results: Record<string, unknown> = {};
        let hadError = false;
        for (const harness of selected) {
          const result = await installMcp(harness);
          results[harness] = result;
          if (result.ok === false) {
            hadError = true;
          }
        }

        if (hadError) {
          process.exitCode = 1;
        }

        return { ok: true, result: { installed: results } };
      });
    });

  // Keep `browser-bridge mcp` working (backwards compatible), but also expose
  // `browser-bridge mcp serve` for clarity.
  mcp
    .option('--name <name>', 'MCP server name')
    .option('--version <version>', 'MCP server version')
    .action(startServer);

  mcp
    .command('serve')
    .description('Run the MCP server over stdio')
    .option('--name <name>', 'MCP server name')
    .option('--version <version>', 'MCP server version')
    .action(startServer);
};
