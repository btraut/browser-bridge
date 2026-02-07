import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CoreClient } from './core-client';
import { createMcpServer, startMcpHttpServer, startMcpServer } from './server';
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

  it('starts streamable HTTP transport on startMcpHttpServer', async () => {
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn(),
    };

    const handle = await startMcpHttpServer({
      coreClient,
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      name: 'test-server',
      version: '0.0.0',
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(
          `http://${handle.host}:${handle.port}${handle.path}`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json, text/event-stream',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'vitest', version: '0.0.0' },
              },
            }),
            signal: controller.signal,
          }
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('mcp-session-id')).toBeTruthy();
        await response.body?.cancel();
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      await handle.close();
    }
  });
});
