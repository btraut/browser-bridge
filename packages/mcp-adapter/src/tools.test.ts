import { describe, expect, it, vi } from "vitest";
import type { CoreClient } from "./core-client";
import { createToolHandler, registerBrowserVisionTools, TOOL_DEFINITIONS } from "./tools";

describe("mcp-adapter tools", () => {
  it("returns a success envelope as structured content", async () => {
    const envelope = { ok: true as const, result: { ok: true } };
    const client: CoreClient = {
      baseUrl: "http://core",
      post: vi.fn().mockResolvedValue(envelope),
    };

    const handler = createToolHandler(client, "/drive/navigate");
    const result = await handler({ session_id: "session-1", url: "https://example.com" });

    expect(client.post).toHaveBeenCalledWith("/drive/navigate", {
      session_id: "session-1",
      url: "https://example.com",
    });
    expect(result.structuredContent).toEqual(envelope);
    expect(result.content[0]?.text).toBe(JSON.stringify(envelope));
  });

  it("propagates error envelopes without modification", async () => {
    const envelope = {
      ok: false as const,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Bad request.",
        retryable: false,
      },
    };
    const client: CoreClient = {
      baseUrl: "http://core",
      post: vi.fn().mockResolvedValue(envelope),
    };

    const handler = createToolHandler(client, "/session/create");
    const result = await handler({});

    expect(result.structuredContent).toEqual(envelope);
  });

  it("registers all tools and forwards to core paths", async () => {
    const calls: string[] = [];
    const configs = new Map<string, { inputSchema?: unknown; outputSchema?: unknown }>();
    const client: CoreClient = {
      baseUrl: "http://core",
      post: vi.fn().mockImplementation(async (path: string) => {
        calls.push(path);
        return { ok: true, result: { ok: true } };
      }),
    };

    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = {
      registerTool: (
        name: string,
        config: { inputSchema?: unknown; outputSchema?: unknown },
        handler: (args: unknown) => Promise<unknown>
      ) => {
        handlers.set(name, handler);
        configs.set(name, config);
        return {};
      },
    };

    registerBrowserVisionTools(server, client);

    const expectedNames = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect([...handlers.keys()]).toEqual(expectedNames);

    for (const tool of TOOL_DEFINITIONS) {
      const handler = handlers.get(tool.name);
      const config = configs.get(tool.name);
      expect(handler).toBeDefined();
      expect(config?.inputSchema).toBe(tool.config.inputSchema);
      expect(config?.outputSchema).toBe(tool.config.outputSchema);
      await handler?.({});
    }

    const expectedPaths = TOOL_DEFINITIONS.map((tool) => tool.config.corePath);
    expect(calls).toEqual(expectedPaths);
  });
});
