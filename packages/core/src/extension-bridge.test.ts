import { describe, expect, it, vi } from "vitest";
import { ExtensionBridge } from "./extension-bridge";

const callPrivate = (bridge: ExtensionBridge, payload: unknown): void => {
  (bridge as unknown as { handleMessage: (data: string) => void }).handleMessage(
    JSON.stringify(payload)
  );
};

describe("ExtensionBridge debugger routing", () => {
  it("forwards debugger events", () => {
    const bridge = new ExtensionBridge();
    const handler = vi.fn();
    bridge.onDebuggerEvent(handler);

    const event = {
      id: "evt-1",
      action: "debugger.event",
      status: "event",
      params: {
        tab_id: 42,
        method: "Runtime.consoleAPICalled",
        params: { type: "log" },
        timestamp: "2026-02-04T00:00:00.000Z",
      },
    };

    callPrivate(bridge, event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("resolves pending debugger acknowledgements", () => {
    const bridge = new ExtensionBridge();
    const resolve = vi.fn();
    const reject = vi.fn();
    const timeout = setTimeout(() => {}, 1000);

    (bridge as unknown as { pending: Map<string, unknown> }).pending.set("req-1", {
      resolve,
      reject,
      timeout,
    });

    const ack = {
      id: "req-1",
      action: "debugger.attach",
      status: "ack",
      result: { ok: true },
    };

    callPrivate(bridge, ack);

    expect(resolve).toHaveBeenCalledWith(ack);
    expect(reject).not.toHaveBeenCalled();
    expect((bridge as unknown as { pending: Map<string, unknown> }).pending.size).toBe(
      0
    );
  });
});
