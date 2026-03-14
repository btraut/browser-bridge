import { describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS_REQUEST_PORT_NAME,
  PermissionsRequestController,
} from './permissions-request';

type FakePort = {
  name: string;
  onMessage: { addListener: (fn: (msg: unknown) => void) => void };
  emit: (msg: unknown) => void;
};

const makeFakePort = (name: string): FakePort => {
  const listeners: Array<(msg: unknown) => void> = [];
  return {
    name,
    onMessage: {
      addListener: (fn) => listeners.push(fn),
    },
    emit: (msg) => {
      for (const fn of listeners) {
        fn(msg);
      }
    },
  };
};

const installFakeRuntimeGetUrl = (): (() => void) => {
  const prev = (globalThis as unknown as { chrome?: unknown }).chrome;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { getURL: (p: string) => `https://example.invalid/${p}` },
  };
  return () => {
    if (prev === undefined) {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    } else {
      (globalThis as unknown as { chrome: unknown }).chrome = prev;
    }
  };
};

describe('permissions request controller', () => {
  it('approves allow-site requests after prompt confirmation', async () => {
    const uninstall = installFakeRuntimeGetUrl();
    try {
      const opened: string[] = [];
      const allowed: string[] = [];
      const port = makeFakePort(PERMISSIONS_REQUEST_PORT_NAME);
      const controller = new PermissionsRequestController({
        openWindow: async (url) => {
          opened.push(url);
          return 41;
        },
        closeWindow: async () => {},
        getDefaultWaitMs: async () => 1000,
        now: () => '2026-03-13T00:00:00.000Z',
        allowSite: async (site) => {
          allowed.push(site);
        },
        revokeSite: async () => {},
        setMode: async () => {},
      });

      controller.handleConnect(port);
      const pending = controller.requestChange({
        kind: 'allow_site',
        site: 'Example.com',
        source: 'cli',
      });

      expect(opened).toHaveLength(1);
      const requestId = new URL(opened[0]).searchParams.get('requestId');
      port.emit({ type: 'decision', requestId, decision: 'approve' });

      await expect(pending).resolves.toEqual({
        request_id: requestId,
        kind: 'allow_site',
        status: 'approved',
        requested_at: '2026-03-13T00:00:00.000Z',
        site: 'example.com',
        source: 'cli',
        message: 'Allow Browser Bridge actions on example.com.',
      });
      expect(allowed).toEqual(['example.com']);
    } finally {
      uninstall();
    }
  });

  it('returns timed_out while keeping the request pending for later approval', async () => {
    vi.useFakeTimers();
    const uninstall = installFakeRuntimeGetUrl();
    try {
      const port = makeFakePort(PERMISSIONS_REQUEST_PORT_NAME);
      const controller = new PermissionsRequestController({
        openWindow: async () => 7,
        closeWindow: async () => {},
        getDefaultWaitMs: async () => 10,
        now: () => '2026-03-13T00:00:00.000Z',
        allowSite: async () => {},
        revokeSite: async () => {},
        setMode: async () => {},
      });

      controller.handleConnect(port);
      const pending = controller.requestChange({
        kind: 'revoke_site',
        site: 'example.com',
        source: 'mcp',
      });

      await vi.advanceTimersByTimeAsync(11);
      await expect(pending).resolves.toEqual({
        request_id: expect.any(String),
        kind: 'revoke_site',
        status: 'timed_out',
        requested_at: '2026-03-13T00:00:00.000Z',
        site: 'example.com',
        source: 'mcp',
        message: 'Permission change request timed out waiting for approval.',
      });
      expect(controller.listPendingRequests()).toEqual([
        {
          request_id: expect.any(String),
          kind: 'revoke_site',
          status: 'pending',
          requested_at: '2026-03-13T00:00:00.000Z',
          site: 'example.com',
          source: 'mcp',
        },
      ]);
    } finally {
      vi.useRealTimers();
      uninstall();
    }
  });

  it('requires extra warning copy for bypass mode requests', async () => {
    const uninstall = installFakeRuntimeGetUrl();
    try {
      const opened: string[] = [];
      const modes: string[] = [];
      const port = makeFakePort(PERMISSIONS_REQUEST_PORT_NAME);
      const controller = new PermissionsRequestController({
        openWindow: async (url) => {
          opened.push(url);
          return 99;
        },
        closeWindow: async () => {},
        getDefaultWaitMs: async () => 1000,
        now: () => '2026-03-13T00:00:00.000Z',
        allowSite: async () => {},
        revokeSite: async () => {},
        setMode: async (mode) => {
          modes.push(mode);
        },
      });

      controller.handleConnect(port);
      const request = controller.requestChange({
        kind: 'set_mode',
        mode: 'bypass',
        source: 'api',
      });

      const url = new URL(opened[0]);
      expect(url.searchParams.get('requireAcknowledge')).toBe('1');
      expect(url.searchParams.get('warning')).toContain(
        'lets the agent act on any website'
      );

      const requestId = url.searchParams.get('requestId');
      port.emit({ type: 'decision', requestId, decision: 'approve' });

      await expect(request).resolves.toEqual({
        request_id: requestId,
        kind: 'set_mode',
        status: 'approved',
        requested_at: '2026-03-13T00:00:00.000Z',
        mode: 'bypass',
        source: 'api',
        warning:
          'Bypass mode lets the agent act on any website without asking first.',
        message: 'Switch Browser Bridge to bypass mode.',
      });
      expect(modes).toEqual(['bypass']);
    } finally {
      uninstall();
    }
  });
});
