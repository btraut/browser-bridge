import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CoreClient } from './core-client';
import { createMcpServer, startMcpHttpServer, startMcpServer } from './server';
import { MCP_TOOL_FIXTURES } from './tool-fixtures';
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

  it('handles tool calls through MCP client transport without output-schema crashes', async () => {
    const fixturesByPath = new Map(
      MCP_TOOL_FIXTURES.map((fixture) => [fixture.corePath, fixture])
    );
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn().mockImplementation(async (path: string, body?: unknown) => {
        const fixture = fixturesByPath.get(path);
        if (!fixture) {
          throw new Error(`Missing fixture for ${path}`);
        }
        expect(body).toEqual(fixture.input);
        return fixture.successEnvelope;
      }),
    };

    const { server } = createMcpServer({ coreClient });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'vitest-client', version: '0.0.0' },
      { capabilities: {} }
    );

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const tools = await client.listTools();
      expect(tools.tools.length).toBe(TOOL_DEFINITIONS.length);

      const result = await client.callTool({
        name: 'session.create',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(
        fixturesByPath.get('/session/create')?.successEnvelope
      );
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
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
