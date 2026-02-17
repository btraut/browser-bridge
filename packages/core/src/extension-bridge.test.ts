import { describe, expect, it, vi } from 'vitest';
import { ExtensionBridge } from './extension-bridge';
import { DRIVE_WS_PROTOCOL_VERSION } from '@btraut/browser-bridge-shared';

const callPrivate = (bridge: ExtensionBridge, payload: unknown): void => {
  (
    bridge as unknown as { handleMessage: (data: string) => void }
  ).handleMessage(JSON.stringify(payload));
};

describe('ExtensionBridge debugger routing', () => {
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
        version: '1.2.3',
        protocol_version: DRIVE_WS_PROTOCOL_VERSION,
        core_host: '127.0.0.1',
        core_port: 3210,
        core_port_source: 'storage',
      },
    };

    callPrivate(bridge, hello);
    expect(bridge.getStatus()).toEqual(
      expect.objectContaining({
        version: '1.2.3',
        protocolVersion: DRIVE_WS_PROTOCOL_VERSION,
        protocolMismatch: undefined,
        coreHost: '127.0.0.1',
        corePort: 3210,
        corePortSource: 'storage',
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
        version: undefined,
        protocolVersion: undefined,
        protocolMismatch: undefined,
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
});
