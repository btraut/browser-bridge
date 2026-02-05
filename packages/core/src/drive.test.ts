import { describe, expect, it, vi } from "vitest";
import { DriveController } from "./drive";
import { SessionRegistry } from "./session";
import { SessionState } from "./state";
import type { ExtensionBridge } from "./extension-bridge";
import { ExtensionBridgeError } from "./extension-bridge";

describe("DriveController", () => {
  it("returns an error when the session is missing", async () => {
    const registry = new SessionRegistry();
    const bridge = {
      isConnected: () => false,
      request: vi.fn(),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(
      "missing-session",
      "drive.navigate",
      { url: "https://example.com" }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_NOT_FOUND");
    }
  });

  it("marks sessions as DRIVE_READY when connected", async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => true,
      request: vi.fn().mockResolvedValue({
        id: "req-1",
        action: "drive.tab_list",
        status: "ok",
        result: { tabs: [] },
      }),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(session.id, "drive.tab_list", {});

    expect(result.ok).toBe(true);
    expect(registry.require(session.id).state).toBe(SessionState.DRIVE_READY);
  });

  it("moves READY sessions to DEGRADED_DRIVE on disconnect errors", async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.apply(session.id, "DRIVE_CONNECTED");
    registry.apply(session.id, "INSPECT_CONNECTED");

    const bridge = {
      isConnected: () => true,
      request: vi
        .fn()
        .mockRejectedValue(
          new ExtensionBridgeError(
            "EXTENSION_DISCONNECTED",
            "Extension disconnected.",
            false
          )
        ),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(session.id, "drive.tab_list", {});

    expect(result.ok).toBe(false);
    expect(registry.require(session.id).state).toBe(SessionState.DEGRADED_DRIVE);
  });
});
