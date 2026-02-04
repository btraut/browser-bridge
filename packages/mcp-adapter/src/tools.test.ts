import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CoreClient } from './core-client';
import { MCP_TOOL_FIXTURES } from './tool-fixtures';
import {
  createToolHandler,
  registerBrowserVisionTools,
  TOOL_DEFINITIONS,
} from './tools';

describe('mcp-adapter tools', () => {
  it('returns a success envelope as structured content', async () => {
    const envelope = { ok: true as const, result: { ok: true } };
    const client: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn().mockResolvedValue(envelope),
    };

    const handler = createToolHandler(client, '/drive/navigate');
    const result = await handler(
      { session_id: 'session-1', url: 'https://example.com' },
      {} as never
    );

    expect(client.post).toHaveBeenCalledWith('/drive/navigate', {
      session_id: 'session-1',
      url: 'https://example.com',
    });
    expect(result.structuredContent).toEqual(envelope);
    const first = result.content[0];
    expect(first?.type).toBe('text');
    if (first && first.type === 'text') {
      expect(first.text).toBe(JSON.stringify(envelope));
    }
  });

  it('propagates error envelopes without modification', async () => {
    const envelope = {
      ok: false as const,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'Bad request.',
        retryable: false,
      },
    };
    const client: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn().mockResolvedValue(envelope),
    };

    const handler = createToolHandler(client, '/session/create');
    const result = await handler({}, {} as never);

    expect(result.structuredContent).toEqual(envelope);
  });

  it('registers all tools and forwards to core paths', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const configs = new Map<
      string,
      {
        inputSchema?: unknown;
        outputSchema?: unknown;
        title?: string;
        description?: string;
      }
    >();
    const fixturesByName = new Map(
      MCP_TOOL_FIXTURES.map((fixture) => [fixture.name, fixture])
    );
    const fixturesByPath = new Map(
      MCP_TOOL_FIXTURES.map((fixture) => [fixture.corePath, fixture])
    );
    const client: CoreClient = {
      baseUrl: 'http://core',
      post: vi.fn().mockImplementation(async (path: string, body?: unknown) => {
        calls.push({ path, body });
        const fixture = fixturesByPath.get(path);
        if (!fixture) {
          throw new Error(`Missing fixture for ${path}`);
        }
        return fixture.successEnvelope;
      }),
    };

    const handlers = new Map<
      string,
      (args: unknown, extra?: unknown) => Promise<unknown>
    >();
    const server: Pick<McpServer, 'registerTool'> = {
      registerTool: (name, config, handler) => {
        handlers.set(
          name,
          handler as (args: unknown, extra?: unknown) => Promise<unknown>
        );
        configs.set(name, {
          title: (config as { title?: string }).title,
          description: (config as { description?: string }).description,
          inputSchema: (config as { inputSchema?: unknown }).inputSchema,
          outputSchema: (config as { outputSchema?: unknown }).outputSchema,
        });
        return {} as never;
      },
    };

    registerBrowserVisionTools(server, client);

    const expectedNames = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect([...handlers.keys()]).toEqual(expectedNames);

    for (const tool of TOOL_DEFINITIONS) {
      const handler = handlers.get(tool.name);
      const config = configs.get(tool.name);
      const fixture = fixturesByName.get(tool.name);
      expect(handler).toBeDefined();
      expect(fixture).toBeDefined();
      expect(config?.title).toBe(tool.config.title);
      expect(config?.description).toBe(tool.config.description);
      expect(config?.inputSchema).toBe(tool.config.inputSchema);
      expect(config?.outputSchema).toBe(tool.config.outputSchema);
      await handler?.(fixture?.input ?? {}, {} as never);
    }

    const expectedPaths = TOOL_DEFINITIONS.map((tool) => tool.config.corePath);
    expect(calls.map((call) => call.path)).toEqual(expectedPaths);
    for (const call of calls) {
      const fixture = fixturesByPath.get(call.path);
      expect(call.body).toEqual(fixture?.input);
    }
  });
});
