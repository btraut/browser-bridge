import { describe, expect, it, vi } from 'vitest';
import { DriveController } from './drive';
import { SessionRegistry } from './session';
import { SessionState } from './state';
import type { ExtensionBridge } from './extension-bridge';
import { ExtensionBridgeError } from './extension-bridge';

describe('DriveController', () => {
  it('returns an error when the session is missing', async () => {
    const registry = new SessionRegistry();
    const bridge = {
      isConnected: () => false,
      request: vi.fn(),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(
      'missing-session',
      'drive.navigate',
      { url: 'https://example.com' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SESSION_NOT_FOUND');
    }
  });

  it('marks sessions as DRIVE_READY when connected', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => true,
      request: vi.fn().mockResolvedValue({
        id: 'req-1',
        action: 'drive.tab_list',
        status: 'ok',
        result: { tabs: [] },
      }),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(session.id, 'drive.tab_list', {});

    expect(result.ok).toBe(true);
    expect(registry.require(session.id).state).toBe(SessionState.DRIVE_READY);
  });

  it('fails fast with an explicit preflight error when extension is disconnected', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => false,
      request: vi.fn(),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(session.id, 'drive.tab_list', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTENSION_DISCONNECTED');
      expect(result.error.message).toContain('Extension is not connected');
    }
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('moves READY sessions to DEGRADED_DRIVE on disconnect errors', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.apply(session.id, 'DRIVE_CONNECTED');
    registry.apply(session.id, 'INSPECT_CONNECTED');

    const bridge = {
      isConnected: () => true,
      request: vi
        .fn()
        .mockRejectedValue(
          new ExtensionBridgeError(
            'EXTENSION_DISCONNECTED',
            'Extension disconnected.',
            false
          )
        ),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const result = await controller.execute(session.id, 'drive.tab_list', {});

    expect(result.ok).toBe(false);
    expect(registry.require(session.id).state).toBe(
      SessionState.DEGRADED_DRIVE
    );
  });

  it('clears last error after a successful retry', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => true,
      request: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'req-1',
          action: 'drive.tab_list',
          status: 'error',
          error: {
            code: 'TIMEOUT',
            message: 'Timed out.',
            retryable: false,
          },
        })
        .mockResolvedValueOnce({
          id: 'req-2',
          action: 'drive.tab_list',
          status: 'ok',
          result: { tabs: [] },
        }),
    } as unknown as ExtensionBridge;

    const controller = new DriveController(bridge, registry);

    const first = await controller.execute(session.id, 'drive.tab_list', {});
    expect(first.ok).toBe(false);
    expect(controller.getLastError()).toBeDefined();

    const second = await controller.execute(session.id, 'drive.tab_list', {});
    expect(second.ok).toBe(true);
    expect(controller.getLastError()).toBeUndefined();
  });

  it('fails fast when loopback navigation target is unreachable', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => true,
      request: vi.fn(),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    const fetchMock = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3072');
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await controller.execute(session.id, 'drive.navigate', {
        url: 'http://127.0.0.1:3072',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NAVIGATION_FAILED');
        expect(result.error.message).toContain('unreachable');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bridge.request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reuses session-selected tab_id when later actions omit tab_id', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => true,
      request: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'req-1',
          action: 'drive.tab_activate',
          status: 'ok',
          result: { ok: true },
        })
        .mockResolvedValueOnce({
          id: 'req-2',
          action: 'drive.click',
          status: 'ok',
          result: { ok: true },
        }),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    await controller.execute(session.id, 'drive.tab_activate', { tab_id: 42 });
    await controller.execute(session.id, 'drive.click', {
      locator: { css: '#submit' },
    });

    expect(bridge.request).toHaveBeenNthCalledWith(
      2,
      'drive.click',
      expect.objectContaining({ tab_id: 42 }),
      undefined
    );
  });

  it('waits briefly after a successful click so deferred click dispatch can land', async () => {
    vi.useFakeTimers();
    try {
      const registry = new SessionRegistry();
      const session = registry.create();
      const bridge = {
        isConnected: () => true,
        request: vi.fn().mockResolvedValue({
          id: 'req-1',
          action: 'drive.click',
          status: 'ok',
          result: { ok: true },
        }),
      } as unknown as ExtensionBridge;
      const controller = new DriveController(bridge, registry);

      let resolved = false;
      const promise = controller.execute(session.id, 'drive.click', {
        locator: { css: '#account-menu' },
      });
      void promise.then(() => {
        resolved = true;
      });

      await Promise.resolve();
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries one transient locator miss for drive.click', async () => {
    vi.useFakeTimers();
    try {
      const registry = new SessionRegistry();
      const session = registry.create();
      const bridge = {
        isConnected: () => true,
        request: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'req-1',
            action: 'drive.click',
            status: 'error',
            error: {
              code: 'NOT_FOUND',
              message: 'Failed to resolve locator.',
              retryable: false,
              details: {
                legacy_code: 'LOCATOR_NOT_FOUND',
                reason: 'locator_not_found',
                resource: 'locator',
              },
            },
          })
          .mockResolvedValueOnce({
            id: 'req-2',
            action: 'drive.click',
            status: 'ok',
            result: { ok: true },
          }),
      } as unknown as ExtensionBridge;
      const controller = new DriveController(bridge, registry);

      const promise = controller.execute(session.id, 'drive.click', {
        locator: { text: 'My decks' },
      });

      await vi.advanceTimersByTimeAsync(300);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(bridge.request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears session-selected tab_id after closing the selected tab', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const bridge = {
      isConnected: () => true,
      request: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'req-1',
          action: 'drive.tab_activate',
          status: 'ok',
          result: { ok: true },
        })
        .mockResolvedValueOnce({
          id: 'req-2',
          action: 'drive.tab_close',
          status: 'ok',
          result: { ok: true },
        })
        .mockResolvedValueOnce({
          id: 'req-3',
          action: 'drive.click',
          status: 'ok',
          result: { ok: true },
        }),
    } as unknown as ExtensionBridge;
    const controller = new DriveController(bridge, registry);

    await controller.execute(session.id, 'drive.tab_activate', { tab_id: 42 });
    await controller.execute(session.id, 'drive.tab_close', { tab_id: 42 });
    await controller.execute(session.id, 'drive.click', {
      locator: { css: '#submit' },
    });

    expect(bridge.request).toHaveBeenNthCalledWith(
      3,
      'drive.click',
      { locator: { css: '#submit' } },
      undefined
    );
  });
});
