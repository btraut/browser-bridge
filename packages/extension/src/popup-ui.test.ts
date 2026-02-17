/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setupDom = (): void => {
  document.body.innerHTML = `
    <a id="bb-settings" href="#"></a>
    <a id="bb-about" href="#"></a>
    <span id="bb-conn-indicator" data-connected="false"></span>
  `;
};

const setupChrome = (): void => {
  const runtime = {
    sendMessage: vi.fn(
      (
        _payload: unknown,
        callback: (response: { ok: boolean; result?: unknown }) => void
      ) => {
        callback({
          ok: true,
          result: {
            state: 'connected',
          },
        });
      }
    ),
    getURL: vi.fn((path: string) => path),
    getManifest: vi.fn(() => ({ version: '0.11.1' })),
    openOptionsPage: vi.fn(async () => undefined),
  };

  (
    globalThis as unknown as {
      chrome: {
        runtime: typeof runtime;
        tabs: { create: (opts: unknown, cb: () => void) => void };
        windows: { create: (opts: unknown, cb: () => void) => void };
      };
    }
  ).chrome = {
    runtime,
    tabs: {
      create: (_opts, cb) => cb(),
    },
    windows: {
      create: (_opts, cb) => cb(),
    },
  };
};

beforeEach(() => {
  vi.resetModules();
  setupDom();
  setupChrome();
});

afterEach(() => {
  window.dispatchEvent(new Event('unload'));
  vi.useRealTimers();
});

describe('popup-ui', () => {
  it('renders connection status from background', async () => {
    await import('./popup-ui');

    expect(
      document.getElementById('bb-conn-indicator')?.dataset.connected
    ).toBe('true');
    expect(
      document.getElementById('bb-conn-indicator')?.getAttribute('aria-label')
    ).toBe('Connected');
  });

  it('falls back to disconnected indicator after refresh failure', async () => {
    vi.useFakeTimers();

    const runtime = (
      globalThis as unknown as {
        chrome: {
          runtime: {
            sendMessage: ReturnType<typeof vi.fn>;
          };
        };
      }
    ).chrome.runtime;

    let statusRequests = 0;
    runtime.sendMessage.mockImplementation(
      (
        _payload: unknown,
        callback: (response: { ok: boolean; result?: unknown }) => void
      ) => {
        statusRequests += 1;
        if (statusRequests === 1) {
          callback({
            ok: true,
            result: {
              state: 'connected',
            },
          });
          return;
        }
        callback({ ok: false });
      }
    );

    await import('./popup-ui');

    await vi.waitFor(() => {
      expect(
        document.getElementById('bb-conn-indicator')?.dataset.connected
      ).toBe('true');
    });

    await vi.advanceTimersByTimeAsync(1500);

    await vi.waitFor(() => {
      expect(
        document.getElementById('bb-conn-indicator')?.dataset.connected
      ).toBe('false');
    });
  });
});
