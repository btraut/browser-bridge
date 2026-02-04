import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCoreClient } from "./core-client";
import { MCP_TOOL_FIXTURES } from "./tool-fixtures";
import { registerBrowserVisionTools } from "./tools";

describe("mcp-adapter integration", () => {
  it("routes tool calls through the core client", async () => {
    const fixturesByPath = new Map(
      MCP_TOOL_FIXTURES.map((fixture) => [fixture.corePath, fixture])
    );
    const requests = new Map<string, unknown>();

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw.length > 0 ? JSON.parse(raw) : undefined;
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const fixture = fixturesByPath.get(url.pathname);

        if (!fixture) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "NOT_FOUND",
                message: `No fixture for ${url.pathname}`,
                retryable: false,
              },
            })
          );
          return;
        }

        requests.set(url.pathname, body);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(fixture.successEnvelope));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const client = createCoreClient({ host: "127.0.0.1", port });
      const handlers = new Map<
        string,
        (args: unknown, extra?: unknown) => Promise<unknown>
      >();
      const toolServer: Pick<McpServer, "registerTool"> = {
        registerTool: (name, _config, handler) => {
          handlers.set(name, handler as (args: unknown, extra?: unknown) => Promise<unknown>);
          return {} as never;
        },
      };

      registerBrowserVisionTools(toolServer, client);

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
        expect(requestBody).toEqual(fixture.input);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
