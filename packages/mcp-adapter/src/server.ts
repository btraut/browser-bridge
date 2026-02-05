import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CoreClient, CoreClientOptions, createCoreClient } from './core-client';
import { registerBrowserVisionTools } from './tools';

export type McpAdapterOptions = CoreClientOptions & {
  name?: string;
  version?: string;
  coreClient?: CoreClient;
};

export type McpAdapterHandle = {
  server: McpServer;
  client: CoreClient;
};

export type McpAdapterStartHandle = McpAdapterHandle & {
  transport: StdioServerTransport;
};

const DEFAULT_SERVER_NAME = 'browser-bridge';
const DEFAULT_SERVER_VERSION = '0.0.0';

export const createMcpServer = (
  options: McpAdapterOptions = {}
): McpAdapterHandle => {
  const server = new McpServer({
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
  });
  const client = options.coreClient ?? createCoreClient(options);

  registerBrowserVisionTools(server, client);

  return { server, client };
};

export const startMcpServer = async (
  options: McpAdapterOptions = {}
): Promise<McpAdapterStartHandle> => {
  const handle = createMcpServer(options);
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
  return { ...handle, transport };
};
