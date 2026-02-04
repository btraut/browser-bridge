import { describe, expect, it } from "vitest";
import { ErrorEnvelopeSchema } from "./errors";
import {
  ArtifactsScreenshotInputSchema,
  DiagnosticsDoctorInputSchema,
  DriveNavigateInputSchema,
  DriveScrollInputSchema,
  InspectDomSnapshotInputSchema,
  LocatorSchema,
  OpResultSchema,
  SessionCreateInputSchema,
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

  it("applies defaults for session create", () => {
    const parsed = SessionCreateInputSchema.parse({});
    expect(parsed.mode).toBe("auto");
  });

  it("parses drive navigate defaults", () => {
    const parsed = DriveNavigateInputSchema.parse({
      session_id: "session-1",
      url: "https://example.com",
    });
    expect(parsed.wait).toBe("domcontentloaded");
  });

  it("parses drive scroll input", () => {
    const parsed = DriveScrollInputSchema.parse({
      session_id: "session-1",
      delta_y: 120,
    });
    expect(parsed.delta_y).toBe(120);
  });

  it("parses inspect dom snapshot defaults", () => {
    const parsed = InspectDomSnapshotInputSchema.parse({
      session_id: "session-1",
    });
    expect(parsed.format).toBe("ax");
    expect(parsed.consistency).toBe("best_effort");
  });

  it("parses artifacts screenshot defaults", () => {
    const parsed = ArtifactsScreenshotInputSchema.parse({
      session_id: "session-1",
    });
    expect(parsed.target).toBe("viewport");
  });

  it("parses diagnostics doctor with optional session", () => {
    const parsed = DiagnosticsDoctorInputSchema.parse({});
    expect(parsed.session_id).toBeUndefined();
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
