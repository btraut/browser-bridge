import { describe, expect, it, vi } from "vitest";
import type { CoreClient } from "./core-client";
import { createToolHandler } from "./tools";

describe("mcp-adapter tool handler errors", () => {
  it("returns thrown error envelopes unchanged", async () => {
    const envelope = {
      ok: false as const,
      error: {
        code: "UNAVAILABLE",
        message: "Core unavailable.",
        retryable: true,
      },
    };
    const client: CoreClient = {
      baseUrl: "http://core",
      post: vi.fn().mockRejectedValue(envelope),
    };

    const handler = createToolHandler(client, "/session/create");
    const result = await handler({}, {} as never);

    expect(result.structuredContent).toEqual(envelope);
  });
});
