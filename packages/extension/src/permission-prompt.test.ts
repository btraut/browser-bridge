import { describe, expect, it, vi } from 'vitest';
import {
  PERMISSION_PROMPT_PORT_NAME,
  PermissionPromptController,
} from './permission-prompt';

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

describe('permission prompt controller', () => {
  it('dedupes concurrent prompts per site and resolves all waiters', async () => {
    const uninstall = installFakeRuntimeGetUrl();
    try {
      const opened: string[] = [];
      const closed: number[] = [];

      const port = makeFakePort(PERMISSION_PROMPT_PORT_NAME);
      const controller = new PermissionPromptController({
        openWindow: async (url) => {
          opened.push(url);
          return 123;
        },
        closeWindow: async (windowId) => {
          closed.push(windowId);
        },
        getWaitMs: async () => 1000,
        persistAlwaysAllow: async () => {},
      });

      controller.handleConnect(port);

      const p1 = controller.requestPermission({
        siteKey: 'example.com',
        action: 'drive.navigate',
      });
      const p2 = controller.requestPermission({
        siteKey: 'example.com',
        action: 'drive.click',
      });

      expect(opened).toHaveLength(1);
      const requestId = new URL(opened[0]).searchParams.get('requestId');
      expect(requestId).toBeTruthy();

      port.emit({ type: 'decision', requestId, decision: 'allow_once' });

      await expect(p1).resolves.toEqual({ kind: 'allow_once' });
      await expect(p2).resolves.toEqual({ kind: 'allow_once' });
      expect(closed).toEqual([123]);
    } finally {
      uninstall();
    }
  });

  it('returns timed_out when no decision arrives within wait window', async () => {
    vi.useFakeTimers();
    const uninstall = installFakeRuntimeGetUrl();
    try {
      const controller = new PermissionPromptController({
        openWindow: async () => 1,
        closeWindow: async () => {},
        getWaitMs: async () => 10,
        persistAlwaysAllow: async () => {},
      });

      const p = controller.requestPermission({
        siteKey: 'example.com',
        action: 'drive.navigate',
      });

      await vi.advanceTimersByTimeAsync(11);
      await expect(p).resolves.toEqual({ kind: 'timed_out', waitMs: 10 });
    } finally {
      vi.useRealTimers();
      uninstall();
    }
  });

  it('persists allow-always even if the caller already timed out', async () => {
    vi.useFakeTimers();
    const uninstall = installFakeRuntimeGetUrl();
    try {
      const opened: string[] = [];
      const persisted: string[] = [];

      const port = makeFakePort(PERMISSION_PROMPT_PORT_NAME);
      const controller = new PermissionPromptController({
        openWindow: async (url) => {
          opened.push(url);
          return 77;
        },
        closeWindow: async () => {},
        getWaitMs: async () => 10,
        persistAlwaysAllow: async (siteKey) => {
          persisted.push(siteKey);
        },
      });

      controller.handleConnect(port);

      const p1 = controller.requestPermission({
        siteKey: 'example.com',
        action: 'drive.navigate',
      });
      await vi.advanceTimersByTimeAsync(11);
      await expect(p1).resolves.toEqual({ kind: 'timed_out', waitMs: 10 });

      const p2 = controller.requestPermission({
        siteKey: 'example.com',
        action: 'drive.navigate',
      });
      expect(opened).toHaveLength(1);
      const requestId = new URL(opened[0]).searchParams.get('requestId');
      port.emit({ type: 'decision', requestId, decision: 'allow_always' });

      await expect(p2).resolves.toEqual({ kind: 'allow_always' });
      expect(persisted).toEqual(['example.com']);
    } finally {
      vi.useRealTimers();
      uninstall();
    }
  });
});
