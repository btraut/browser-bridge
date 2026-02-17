import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCoreClient } from './core-client';
import { MCP_TOOL_FIXTURES } from './tool-fixtures';
import { registerBrowserBridgeTools } from './tools';

const makeSpawnImpl = (): typeof spawn =>
  vi.fn(
    () =>
      ({
        on: vi.fn(),
        unref: vi.fn(),
      }) as unknown as ReturnType<typeof spawn>
  ) as unknown as typeof spawn;

describe('mcp-adapter integration', () => {
  it('routes tool calls through the core client and ensure-ready bootstrap', async () => {
    const fixturesByPath = new Map(
      MCP_TOOL_FIXTURES.map((fixture) => [fixture.corePath, fixture])
    );
    const requests = new Map<string, unknown>();
    let healthChecks = 0;

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw.length > 0 ? JSON.parse(raw) : undefined;
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

        if (url.pathname === '/health') {
          healthChecks += 1;
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        const fixture = fixturesByPath.get(url.pathname);

        if (!fixture) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: 'NOT_FOUND',
                message: `No fixture for ${url.pathname}`,
                retryable: false,
              },
            })
          );
          return;
        }

        requests.set(url.pathname, body);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(fixture.successEnvelope));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const spawnImpl = makeSpawnImpl();
      const client = createCoreClient({
        host: '127.0.0.1',
        port,
        ensureDaemon: true,
        fetchImpl: fetch,
        spawnImpl,
      });
      const handlers = new Map<
        string,
        (args: unknown, extra?: unknown) => Promise<unknown>
      >();
      const toolServer: Pick<McpServer, 'registerTool'> = {
        registerTool: (name, _config, handler) => {
          handlers.set(
            name,
            handler as (args: unknown, extra?: unknown) => Promise<unknown>
          );
          return {} as never;
        },
      };

      registerBrowserBridgeTools(toolServer, client);

      for (const fixture of MCP_TOOL_FIXTURES) {
        const handler = handlers.get(fixture.name);
        expect(handler).toBeDefined();
        const result = await handler?.(fixture.input, {} as never);
        expect(result).toEqual(
          expect.objectContaining({
            structuredContent: fixture.successEnvelope,
          })
        );
      }

      for (const fixture of MCP_TOOL_FIXTURES) {
        const requestBody = requests.get(fixture.corePath);
        if (fixture.corePath === '/diagnostics/doctor') {
          expect(requestBody).toEqual(
            expect.objectContaining(fixture.input as Record<string, unknown>)
          );
          expect(
            (requestBody as { caller?: { process?: { component?: string } } })
              .caller?.process?.component
          ).toBe('mcp');
        } else {
          expect(requestBody).toEqual(fixture.input);
        }
      }
      expect(healthChecks).toBeGreaterThan(0);
      expect(spawnImpl).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
