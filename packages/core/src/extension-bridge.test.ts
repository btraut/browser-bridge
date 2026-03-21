import { describe, expect, it, vi } from 'vitest';
import { ExtensionBridge } from './extension-bridge';
import { DRIVE_WS_PROTOCOL_VERSION } from '@btraut/browser-bridge-shared';

const callPrivate = (bridge: ExtensionBridge, payload: unknown): void => {
  (
    bridge as unknown as { handleMessage: (data: string) => void }
  ).handleMessage(JSON.stringify(payload));
};

describe('ExtensionBridge debugger routing', () => {
  it('waits briefly for drive.hello before reporting ready', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new ExtensionBridge();
      const writable = bridge as unknown as { connected: boolean };
      writable.connected = true;

      let ready = false;
      const promise = bridge.waitForReady(500);
      void promise.then((value) => {
        ready = value;
      });

      await Promise.resolve();
      expect(ready).toBe(false);

      callPrivate(bridge, {
        id: 'evt-hello',
        action: 'drive.hello',
        status: 'event',
        params: {
          version: '1.2.3',
          protocol_version: DRIVE_WS_PROTOCOL_VERSION,
          capabilities: {
            'drive.navigate': true,
          },
          tabs: [],
        },
      });

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out waitForReady when the extension never becomes request-ready', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new ExtensionBridge();
      const promise = bridge.waitForReady(200);
      await vi.advanceTimersByTimeAsync(250);
      await expect(promise).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards debugger events', () => {
    const bridge = new ExtensionBridge();
    const handler = vi.fn();
    bridge.onDebuggerEvent(handler);

    const event = {
      id: 'evt-1',
      action: 'debugger.event',
      status: 'event',
      params: {
        tab_id: 42,
        method: 'Runtime.consoleAPICalled',
        params: { type: 'log' },
        timestamp: '2026-02-04T00:00:00.000Z',
      },
    };

    callPrivate(bridge, event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('resolves pending debugger acknowledgements', () => {
    const bridge = new ExtensionBridge();
    const resolve = vi.fn();
    const reject = vi.fn();
    const timeout = setTimeout(() => {}, 1000);

    (bridge as unknown as { pending: Map<string, unknown> }).pending.set(
      'req-1',
      {
        resolve,
        reject,
        timeout,
      }
    );

    const ack = {
      id: 'req-1',
      action: 'debugger.attach',
      status: 'ack',
      result: { ok: true },
    };

    callPrivate(bridge, ack);

    expect(resolve).toHaveBeenCalledWith(ack);
    expect(reject).not.toHaveBeenCalled();
    expect(
      (bridge as unknown as { pending: Map<string, unknown> }).pending.size
    ).toBe(0);
  });

  it('clears runtime identity fields on disconnect', () => {
    const bridge = new ExtensionBridge();
    const hello = {
      id: 'evt-hello',
      action: 'drive.hello',
      status: 'event',
      params: {
        extension_id: 'abcdefghijklmnopabcdefghijklmnop',
        version: '1.2.3',
        protocol_version: DRIVE_WS_PROTOCOL_VERSION,
        capabilities: {
          'drive.navigate': true,
          'drive.handle_dialog': true,
        },
        core_host: '127.0.0.1',
        core_port: 3210,
        core_port_source: 'default',
      },
    };

    callPrivate(bridge, hello);
    expect(bridge.getStatus()).toEqual(
      expect.objectContaining({
        version: '1.2.3',
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        protocolVersion: DRIVE_WS_PROTOCOL_VERSION,
        protocolMismatch: undefined,
        capabilityNegotiated: true,
        capabilities: {
          'drive.navigate': true,
          'drive.handle_dialog': true,
        },
        coreHost: '127.0.0.1',
        corePort: 3210,
        corePortSource: 'default',
      })
    );

    const writableBridge = bridge as unknown as {
      connected: boolean;
      handleDisconnect: () => void;
    };
    writableBridge.connected = true;
    writableBridge.handleDisconnect();

    expect(bridge.getStatus()).toEqual(
      expect.objectContaining({
        connected: false,
        extensionId: undefined,
        version: undefined,
        protocolVersion: undefined,
        protocolMismatch: undefined,
        capabilityNegotiated: false,
        capabilities: {},
        coreHost: undefined,
        corePort: undefined,
        corePortSource: undefined,
      })
    );
  });

  it('fails requests deterministically on websocket protocol mismatch', async () => {
    const bridge = new ExtensionBridge();
    const hello = {
      id: 'evt-hello',
      action: 'drive.hello',
      status: 'event',
      params: {
        version: '1.2.3',
        protocol_version: 'legacy-0',
        tabs: [],
      },
    };

    callPrivate(bridge, hello);

    await expect(bridge.request('drive.navigate', {})).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: {
        expected: DRIVE_WS_PROTOCOL_VERSION,
        received: 'legacy-0',
      },
    });
  });

  it('returns deterministic errors when requested action is not negotiated', async () => {
    const bridge = new ExtensionBridge();
    const writable = bridge as unknown as {
      connected: boolean;
      socket: { readyState: number; send: (message: string) => void };
      capabilityNegotiated: boolean;
      capabilities: Record<string, boolean>;
    };
    writable.connected = true;
    writable.socket = {
      readyState: 1,
      send: vi.fn(),
    };
    writable.capabilityNegotiated = true;
    writable.capabilities = {
      'drive.navigate': true,
    };

    await expect(bridge.request('drive.click', {})).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      details: { action: 'drive.click' },
    });
  });

  it('fails deterministically when drive.hello omits capabilities', async () => {
    const bridge = new ExtensionBridge();
    const writable = bridge as unknown as {
      connected: boolean;
      socket: { readyState: number; send: (message: string) => void };
    };
    writable.connected = true;
    writable.socket = {
      readyState: 1,
      send: vi.fn(),
    };

    callPrivate(bridge, {
      id: 'evt-hello',
      action: 'drive.hello',
      status: 'event',
      params: {
        version: '1.2.3',
        protocol_version: DRIVE_WS_PROTOCOL_VERSION,
        tabs: [],
      },
    });

    expect(bridge.getStatus()).toEqual(
      expect.objectContaining({
        capabilityNegotiated: true,
        capabilities: {},
      })
    );

    await expect(bridge.request('drive.navigate', {})).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      retryable: false,
      details: {
        action: 'drive.navigate',
        reason: 'missing_capabilities',
        expected: 'drive.hello.capabilities',
      },
    });
  });
});
