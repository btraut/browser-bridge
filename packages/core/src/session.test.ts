import { describe, expect, it } from "vitest";
import { SessionRegistry } from "./session";

describe("SessionRegistry.recover", () => {
  it("transitions DEGRADED_DRIVE to READY on successful recovery", () => {
    const registry = new SessionRegistry();
    const session = registry.create("auto");
    registry.apply(session.id, "DRIVE_CONNECTED");
    registry.apply(session.id, "INSPECT_CONNECTED");
    registry.apply(session.id, "DRIVE_DISCONNECTED");

    const result = registry.recover(session.id, {
      recovered: true,
      message: "Drive recovered.",
    });

    expect(result.recovered).toBe(true);
    expect(result.state).toBe("READY");
  });

  it("transitions DEGRADED_INSPECT to BROKEN on failed recovery", () => {
    const registry = new SessionRegistry();
    const session = registry.create("auto");
    registry.apply(session.id, "DRIVE_CONNECTED");
    registry.apply(session.id, "INSPECT_CONNECTED");
    registry.apply(session.id, "INSPECT_DISCONNECTED");

    const result = registry.recover(session.id, {
      recovered: false,
      message: "Inspect recovery failed.",
    });

    expect(result.recovered).toBe(false);
    expect(result.state).toBe("BROKEN");
  });
});
