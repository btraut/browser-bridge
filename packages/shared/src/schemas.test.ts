import { describe, expect, it } from "vitest";
import { ErrorEnvelopeSchema } from "./errors";
import {
  LocatorSchema,
  OpResultSchema,
  SessionStatusSchema,
} from "./schemas";

describe("shared schemas", () => {
  it("requires a locator selector", () => {
    expect(() => LocatorSchema.parse({})).toThrow();
    expect(LocatorSchema.parse({ testid: "submit" }).testid).toBe("submit");
  });

  it("parses an op result", () => {
    expect(OpResultSchema.parse({ ok: true }).ok).toBe(true);
  });

  it("validates the error envelope shape", () => {
    const parsed = ErrorEnvelopeSchema.parse({
      ok: false,
      error: {
        code: "TIMEOUT",
        message: "Timed out",
        retryable: true,
      },
    });

    expect(parsed.error.retryable).toBe(true);
  });

  it("allows session status with plane errors", () => {
    const parsed = SessionStatusSchema.parse({
      session_id: "session-1",
      state: "READY",
      drive: { connected: true },
      inspect: {
        connected: false,
        error: {
          code: "CDP_DISCONNECTED",
          message: "CDP down",
          retryable: true,
        },
      },
    });

    expect(parsed.inspect?.error?.code).toBe("CDP_DISCONNECTED");
  });
});
