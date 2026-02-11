import { describe, expect, it, vi } from 'vitest';
import { DebuggerBridge } from './debugger-bridge';
import type { ExtensionBridge } from './extension-bridge';
import type { DebuggerEvent } from './drive-protocol';

describe('DebuggerBridge', () => {
  it('attaches and records console events', async () => {
    let listener: ((event: DebuggerEvent) => void) | undefined;
    const requestDebugger = vi.fn().mockResolvedValue({
      id: 'req-1',
      action: 'debugger.attach',
      status: 'ack',
      result: { ok: true },
    });
    const bridge = {
      requestDebugger,
      onDebuggerEvent: (cb: (event: DebuggerEvent) => void) => {
        listener = cb;
        return () => undefined;
      },
    } as unknown as ExtensionBridge;

    const debuggerBridge = new DebuggerBridge({
      extensionBridge: bridge,
      consoleBufferSize: 5,
      networkBufferSize: 5,
      idleTimeoutMs: 10000,
    });

    try {
      const attachResult = await debuggerBridge.attach(1);
      expect(attachResult.ok).toBe(true);
      expect(debuggerBridge.hasAttachments()).toBe(true);

      listener?.({
        id: 'evt-1',
        action: 'debugger.event',
        status: 'event',
        params: {
          tab_id: 1,
          method: 'Runtime.consoleAPICalled',
          params: {},
          timestamp: '2025-01-01T00:00:00Z',
        },
      });

      const events = debuggerBridge.getConsoleEvents(1);
      expect(events).toHaveLength(1);
      expect(events[0].method).toBe('Runtime.consoleAPICalled');
    } finally {
      debuggerBridge.shutdown();
    }
  });

  it('keeps attachments when detach fails', async () => {
    const requestDebugger = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'req-1',
        action: 'debugger.attach',
        status: 'ack',
        result: { ok: true },
      })
      .mockResolvedValueOnce({
        id: 'req-2',
        action: 'debugger.detach',
        status: 'error',
        error: {
          code: 'INSPECT_UNAVAILABLE',
          message: 'Detach failed.',
          retryable: false,
        },
      });

    const bridge = {
      requestDebugger,
      onDebuggerEvent: () => () => undefined,
    } as unknown as ExtensionBridge;

    const debuggerBridge = new DebuggerBridge({
      extensionBridge: bridge,
      consoleBufferSize: 5,
      networkBufferSize: 5,
      idleTimeoutMs: 10000,
    });

    try {
      await debuggerBridge.attach(1);
      const detachResult = await debuggerBridge.detach(1);
      expect(detachResult.ok).toBe(false);
      expect(debuggerBridge.hasAttachments()).toBe(true);
    } finally {
      debuggerBridge.shutdown();
    }
  });

  it('clears last error after a successful attach', async () => {
    const requestDebugger = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'req-1',
        action: 'debugger.attach',
        status: 'error',
        error: {
          code: 'INSPECT_UNAVAILABLE',
          message: 'Attach failed.',
          retryable: false,
        },
      })
      .mockResolvedValueOnce({
        id: 'req-2',
        action: 'debugger.attach',
        status: 'ack',
        result: { ok: true },
      });

    const bridge = {
      requestDebugger,
      onDebuggerEvent: () => () => undefined,
    } as unknown as ExtensionBridge;

    const debuggerBridge = new DebuggerBridge({
      extensionBridge: bridge,
      consoleBufferSize: 5,
      networkBufferSize: 5,
      idleTimeoutMs: 10000,
    });

    try {
      const failed = await debuggerBridge.attach(1);
      expect(failed.ok).toBe(false);
      expect(debuggerBridge.getLastError()).toBeDefined();

      const succeeded = await debuggerBridge.attach(1);
      expect(succeeded.ok).toBe(true);
      expect(debuggerBridge.getLastError()).toBeUndefined();
    } finally {
      debuggerBridge.shutdown();
    }
  });
});
