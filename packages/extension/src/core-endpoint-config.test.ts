import { describe, expect, it, vi } from 'vitest';
import {
  clearLegacyCorePort,
  DEFAULT_CORE_HOST,
  DEFAULT_CORE_PORT,
  LEGACY_CORE_PORT_KEY,
  readCoreEndpointConfig,
} from './core-endpoint-config';

describe('core endpoint config', () => {
  it('always resolves the default core endpoint', async () => {
    await expect(readCoreEndpointConfig()).resolves.toEqual({
      host: DEFAULT_CORE_HOST,
      port: DEFAULT_CORE_PORT,
      portSource: 'default',
    });
  });

  it('removes legacy corePort storage when present', async () => {
    const remove = vi.fn((_keys: string[], callback?: () => void) => {
      callback?.();
    });
    const storage = {
      get: vi.fn((keys: string[], callback: (items: Record<string, unknown>) => void) => {
        expect(keys).toEqual([LEGACY_CORE_PORT_KEY]);
        callback({ [LEGACY_CORE_PORT_KEY]: 4224 });
      }),
      remove,
    };

    await expect(clearLegacyCorePort(storage)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith([LEGACY_CORE_PORT_KEY], expect.any(Function));
  });

  it('leaves storage alone when legacy corePort is absent', async () => {
    const storage = {
      get: vi.fn((_keys: string[], callback: (items: Record<string, unknown>) => void) => {
        callback({});
      }),
      remove: vi.fn(),
    };

    await expect(clearLegacyCorePort(storage)).resolves.toBe(false);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
