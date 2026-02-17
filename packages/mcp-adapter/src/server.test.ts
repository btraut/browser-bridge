import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CoreClient } from './core-client';
import { createMcpServer, startMcpHttpServer, startMcpServer } from './server';
import { MCP_TOOL_FIXTURES } from './tool-fixtures';
import { TOOL_DEFINITIONS } from './tools';

const fixturesByPath = new Map(
  MCP_TOOL_FIXTURES.map((fixture) => [fixture.corePath, fixture])
);
const fixturesByName = new Map(
  MCP_TOOL_FIXTURES.map((fixture) => [fixture.name, fixture])
);
const trackedTempDirs: string[] = [];

const createGitRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedTempDirs.push(root);
  mkdirSync(path.join(root, '.git'), { recursive: true });
  return root;
};

const collectHandlers = (
  registerSpy: ReturnType<typeof vi.spyOn>
): Map<string, (args: unknown, extra?: unknown) => Promise<unknown>> => {
  const handlers = new Map<
    string,
    (args: unknown, extra?: unknown) => Promise<unknown>
  >();

  for (const [name, , handler] of registerSpy.mock.calls) {
    handlers.set(
      name as string,
      handler as (args: unknown, extra?: unknown) => Promise<unknown>
    );
  }

  return handlers;
};

afterEach(() => {
  while (trackedTempDirs.length > 0) {
    const dir = trackedTempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('mcp-adapter server', () => {
  it('registers all tools on createMcpServer', () => {
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi.fn(),
    };

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');

    const { client } = createMcpServer({ coreClient });

    expect(client).toBe(coreClient);

    const registeredTools = registerSpy.mock.calls.map((call) => call[0]);
    const expectedNames = TOOL_DEFINITIONS.map((tool) => tool.name);

    expect(registeredTools).toEqual(expectedNames);
  });

  it('does not write files on startup before the first tool call', async () => {
    const root = createGitRoot('mcp-lazy-startup-');
    const coreClientFactory = vi.fn(async () => ({
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi.fn(),
    }));
    const connectSpy = vi
      .spyOn(McpServer.prototype, 'connect')
      .mockResolvedValue(undefined);

    await startMcpServer({
      cwd: root,
      coreClientFactory,
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(coreClientFactory).not.toHaveBeenCalled();
    expect(existsSync(path.join(root, '.context'))).toBe(false);
  });

  it('initializes on first tool call exactly once', async () => {
    const root = createGitRoot('mcp-lazy-single-init-');
    const post = vi
      .fn()
      .mockResolvedValue(
        fixturesByPath.get('/session/create')?.successEnvelope
      );
    const coreClientFactory = vi.fn(async () => ({
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post,
    }));

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    createMcpServer({
      cwd: root,
      coreClientFactory,
    });

    const handlers = collectHandlers(registerSpy);
    const sessionCreate = handlers.get('session.create');

    expect(sessionCreate).toBeDefined();

    await sessionCreate?.({}, {} as never);
    await sessionCreate?.({}, {} as never);

    expect(coreClientFactory).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('uses single-flight initialization for concurrent first tool calls', async () => {
    const root = createGitRoot('mcp-lazy-concurrency-');
    const post = vi
      .fn()
      .mockResolvedValue(
        fixturesByPath.get('/session/create')?.successEnvelope
      );

    const coreClientFactory = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      return {
        baseUrl: 'http://core',
        ensureReady: vi.fn().mockResolvedValue(undefined),
        post,
      } satisfies CoreClient;
    });

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    createMcpServer({
      cwd: root,
      coreClientFactory,
    });

    const handlers = collectHandlers(registerSpy);
    const sessionCreate = handlers.get('session.create');
    const healthCheck = handlers.get('health_check');

    expect(sessionCreate).toBeDefined();
    expect(healthCheck).toBeDefined();

    await Promise.all([
      sessionCreate?.(
        fixturesByName.get('session.create')?.input ?? {},
        {} as never
      ),
      healthCheck?.(
        fixturesByName.get('health_check')?.input ?? {},
        {} as never
      ),
    ]);

    expect(coreClientFactory).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('keeps logs absent before init and flushes buffered logs after init', async () => {
    const root = createGitRoot('mcp-lazy-logs-');
    const coreClientFactory = vi.fn(async () => ({
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi
        .fn()
        .mockResolvedValue(
          fixturesByPath.get('/session/create')?.successEnvelope
        ),
    }));

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    createMcpServer({
      cwd: root,
      coreClientFactory,
    });

    const logDir = path.join(root, '.context', 'logs', 'browser-bridge');
    const logFile = path.join(logDir, 'mcp-adapter.jsonl');

    expect(existsSync(logDir)).toBe(false);
    expect(existsSync(logFile)).toBe(false);

    const sessionCreate = collectHandlers(registerSpy).get('session.create');
    await sessionCreate?.({}, {} as never);

    expect(existsSync(logFile)).toBe(true);
    expect(readFileSync(logFile, 'utf8')).toContain('mcp.server.created');
  });

  it('returns a clear MCP error when lazy initialization fails without creating files', async () => {
    const root = createGitRoot('mcp-lazy-init-failure-');
    const coreClientFactory = vi
      .fn()
      .mockRejectedValue(new Error('Core is unavailable right now.'));

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    createMcpServer({
      cwd: root,
      coreClientFactory,
    });

    const sessionCreate = collectHandlers(registerSpy).get('session.create');
    const result = await sessionCreate?.({}, {} as never);

    expect(result).toEqual(
      expect.objectContaining({
        isError: true,
        structuredContent: {
          ok: false,
          error: expect.objectContaining({
            code: 'UNAVAILABLE',
            message: expect.stringContaining(
              'MCP runtime initialization failed'
            ),
          }),
        },
      })
    );
    expect(existsSync(path.join(root, '.context'))).toBe(false);
  });

  it('retries initialization after a first-call failure', async () => {
    const root = createGitRoot('mcp-lazy-retry-after-failure-');
    let attempts = 0;

    const coreClientFactory = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary init failure');
      }
      return {
        baseUrl: 'http://core',
        ensureReady: vi.fn().mockResolvedValue(undefined),
        post: vi
          .fn()
          .mockResolvedValue(
            fixturesByPath.get('/session/create')?.successEnvelope
          ),
      } satisfies CoreClient;
    });

    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    createMcpServer({
      cwd: root,
      coreClientFactory,
    });

    const sessionCreate = collectHandlers(registerSpy).get('session.create');
    expect(sessionCreate).toBeDefined();

    const first = await sessionCreate?.({}, {} as never);
    expect(first).toEqual(
      expect.objectContaining({
        isError: true,
      })
    );

    const second = await sessionCreate?.({}, {} as never);
    expect(second).toEqual(
      expect.objectContaining({
        isError: false,
      })
    );
    expect(coreClientFactory).toHaveBeenCalledTimes(2);
  });

  it('supports eager mode explicitly and via env override', async () => {
    const connectSpy = vi
      .spyOn(McpServer.prototype, 'connect')
      .mockResolvedValue(undefined);

    const eagerFactory = vi.fn(async () => ({
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi.fn(),
    }));
    await startMcpServer({
      coreClientFactory: eagerFactory,
      eager: true,
    });
    expect(eagerFactory).toHaveBeenCalledTimes(1);

    const envFactory = vi.fn(async () => ({
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi.fn(),
    }));
    vi.stubEnv('BROWSER_BRIDGE_MCP_EAGER', '1');
    await startMcpServer({
      coreClientFactory: envFactory,
    });
    expect(envFactory).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('connects via stdio transport on startMcpServer', async () => {
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi.fn(),
    };

    const connectSpy = vi
      .spyOn(McpServer.prototype, 'connect')
      .mockResolvedValue(undefined);

    const handle = await startMcpServer({ coreClient });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const transport = connectSpy.mock.calls[0]?.[0];
    expect(transport).toBeInstanceOf(StdioServerTransport);
    expect(handle.transport).toBeInstanceOf(StdioServerTransport);
  });

  it('handles tool calls through MCP client transport without output-schema crashes', async () => {
    const coreClient: CoreClient = {
      baseUrl: 'http://core',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      post: vi
        .fn()
        .mockImplementation(async (toolPath: string, body?: unknown) => {
          const fixture = fixturesByPath.get(toolPath);
          if (!fixture) {
            throw new Error(`Missing fixture for ${toolPath}`);
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
      ensureReady: vi.fn().mockResolvedValue(undefined),
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
