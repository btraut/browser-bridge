import { describe, expect, it, vi } from "vitest";
import { createCoreClient } from "./core-client";

const makeResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe("createCoreClient", () => {
  it("posts to Core with JSON payload", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: true, result: { value: "ok" } })
    ) as unknown as typeof fetch;

    const client = createCoreClient({
      host: "127.0.0.1",
      port: 3210,
      ensureDaemon: false,
      fetchImpl,
    });

    const result = await client.post("/session/create", { mode: "auto" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/session/create",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      })
    );
    expect(result).toEqual({ ok: true, result: { value: "ok" } });
  });

  it("checks health before posting when daemon is enabled", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return makeResponse({ ok: true });
      }
      return makeResponse({ ok: true, result: { ok: true } });
    }) as unknown as typeof fetch;

    const client = createCoreClient({
      host: "127.0.0.1",
      port: 3210,
      ensureDaemon: true,
      fetchImpl,
    });

    const result = await client.post("/session/status", { session_id: "s1" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/health",
      expect.anything()
    );
    expect(result).toEqual({ ok: true, result: { ok: true } });
  });
});
