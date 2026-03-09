import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const unrefMock = vi.fn();
const originalPlatform = process.platform;

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('openPath', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    unrefMock.mockReset();
    spawnMock.mockReturnValue({ unref: unrefMock });
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
    vi.resetModules();
  });

  it('opens chrome-extension URLs in Google Chrome on macOS', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    const { openPath } = await import('./open-path');
    await openPath(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html?bb_enable_inspect=1'
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      [
        '-a',
        'Google Chrome',
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html?bb_enable_inspect=1',
      ],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    expect(unrefMock).toHaveBeenCalled();
  });

  it('keeps the generic open flow for normal paths on macOS', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    const { openPath } = await import('./open-path');
    await openPath('/tmp/browser-bridge-artifacts');

    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      ['/tmp/browser-bridge-artifacts'],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    expect(unrefMock).toHaveBeenCalled();
  });
});
