import { describe, expect, it } from "vitest";
import { InspectService } from "./inspect";
import { SessionRegistry } from "./session";
import type { DebuggerBridge } from "./debugger-bridge";

describe("InspectService", () => {
  it("wraps debugger errors when no local errors are recorded", () => {
    const registry = new SessionRegistry();
    const debuggerBridge = {
      getLastError: () => ({
        error: {
          code: "TAB_NOT_FOUND",
          message: "No tab.",
          retryable: true,
        },
        at: "2025-01-01T00:00:00Z",
      }),
      hasAttachments: () => false,
    } as unknown as DebuggerBridge;

    const service = new InspectService({ registry, debuggerBridge });
    const lastError = service.getLastError();

    expect(lastError?.error.code).toBe("INSPECT_UNAVAILABLE");
    expect(lastError?.error.details?.code).toBe("TAB_NOT_FOUND");
  });

  it("throws INSPECT_UNAVAILABLE when debugger is missing", async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.apply(session.id, "DRIVE_CONNECTED");
    registry.apply(session.id, "INSPECT_CONNECTED");

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({
          tabs: [
            {
              tab_id: 1,
              url: "https://example.com",
              title: "Example",
              window_id: 1,
              last_active_at: "2025-01-01T00:00:00Z",
            },
          ],
        }),
      },
    });

    await expect(
      service.consoleList({ sessionId: session.id })
    ).rejects.toMatchObject({ code: "INSPECT_UNAVAILABLE" });
  });
});
