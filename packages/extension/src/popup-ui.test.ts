/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setupDom = (): void => {
  document.body.innerHTML = `
    <a id="bb-settings" href="#"></a>
    <a id="bb-about" href="#"></a>
    <span id="bb-conn-state"></span>
    <span id="bb-conn-endpoint"></span>
    <span id="bb-conn-source"></span>
    <span id="bb-conn-last-ok"></span>
    <span id="bb-conn-last-fail"></span>
    <span id="bb-conn-next-retry"></span>
    <span id="bb-conn-error"></span>
    <button id="bb-copy-diagnostics" type="button"></button>
    <span id="bb-copy-status"></span>
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
            endpoint: {
              host: '127.0.0.1',
              port: 3210,
              portSource: 'default',
            },
            ws_url: 'ws://127.0.0.1:3210/drive',
            consecutive_failures: 0,
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

    expect(document.getElementById('bb-conn-state')?.textContent).toBe(
      'connected'
    );
    expect(document.getElementById('bb-conn-endpoint')?.textContent).toBe(
      'ws://127.0.0.1:3210/drive'
    );
    expect(document.getElementById('bb-conn-source')?.textContent).toBe(
      'default'
    );
  });

  it('copies diagnostics payload', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await import('./popup-ui');
    const button = document.getElementById('bb-copy-diagnostics');
    button?.dispatchEvent(new MouseEvent('click'));
    await vi.waitFor(() => {
      expect(document.getElementById('bb-copy-status')?.textContent).toBe(
        'Copied diagnostics.'
      );
    });

    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('does not copy stale diagnostics after refresh failure', async () => {
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
              endpoint: {
                host: '127.0.0.1',
                port: 3210,
                portSource: 'default',
              },
              ws_url: 'ws://127.0.0.1:3210/drive',
              consecutive_failures: 0,
            },
          });
          return;
        }
        callback({ ok: false });
      }
    );

    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await import('./popup-ui');

    await vi.waitFor(() => {
      expect(document.getElementById('bb-conn-state')?.textContent).toBe(
        'connected'
      );
    });

    await vi.advanceTimersByTimeAsync(1500);

    await vi.waitFor(() => {
      expect(document.getElementById('bb-conn-error')?.textContent).toBe(
        'Connection status is unavailable.'
      );
    });

    document
      .getElementById('bb-copy-diagnostics')
      ?.dispatchEvent(new MouseEvent('click'));

    await vi.waitFor(() => {
      expect(document.getElementById('bb-copy-status')?.textContent).toBe(
        'Connection status unavailable.'
      );
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});
