import { Command } from 'commander';
import { startMcpServer } from '@btraut/browser-bridge-mcp-adapter';
import { createCoreClient } from '../core-client';
import { getGlobalOptions } from '../cli-runtime';

type McpCommandOptions = {
  name?: string;
  version?: string;
};

export const registerMcpCommand = (program: Command): void => {
  program
    .command('mcp')
    .description('Run the MCP server over stdio')
    .option('--name <name>', 'MCP server name')
    .option('--version <version>', 'MCP server version')
    .action(async (options: McpCommandOptions, command: Command) => {
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
    });
};
