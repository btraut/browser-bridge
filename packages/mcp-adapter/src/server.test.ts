import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CoreClient } from './core-client';
import { createMcpServer, startMcpServer } from './server';
import { TOOL_DEFINITIONS } from './tools';

describe('mcp-adapter server', () => {
  it('registers all tools on createMcpServer', () => {
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn(),
    };

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');

    try {
      const { client } = createMcpServer({ coreClient });

      expect(client).toBe(coreClient);

      const registeredTools = registerSpy.mock.calls.map((call) => call[0]);
      const expectedNames = TOOL_DEFINITIONS.map((tool) => tool.name);

      expect(registeredTools).toEqual(expectedNames);
    } finally {
      registerSpy.mockRestore();
    }
  });

  it('connects via stdio transport on startMcpServer', async () => {
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn(),
    };

    const connectSpy = vi
      .spyOn(McpServer.prototype, 'connect')
      .mockResolvedValue(undefined);

    try {
      const handle = await startMcpServer({ coreClient });

      expect(connectSpy).toHaveBeenCalledTimes(1);
      const transport = connectSpy.mock.calls[0]?.[0];
      expect(transport).toBeInstanceOf(StdioServerTransport);
      expect(handle.transport).toBeInstanceOf(StdioServerTransport);
    } finally {
      connectSpy.mockRestore();
    }
  });
});
