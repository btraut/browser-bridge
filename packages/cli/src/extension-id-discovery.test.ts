import { describe, expect, it, vi } from 'vitest';
import {
  __private__,
  discoverActivationExtensionId,
} from './extension-id-discovery';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';

const dirent = (name: string) => ({
  name,
  isDirectory: () => true,
});

describe('extension-id-discovery', () => {
  it('extracts Browser Bridge extension id from manifest name', () => {
    const raw = JSON.stringify({
      extensions: {
        settings: {
          [EXT_ID]: {
            manifest: {
              name: 'Browser Bridge',
            },
          },
        },
      },
    });

    expect(
      __private__.extractBrowserBridgeIdsFromSecurePreferences(raw)
    ).toEqual([EXT_ID]);
  });

  it('extracts Browser Bridge extension id from unpacked path hint', () => {
    const raw = JSON.stringify({
      extensions: {
        settings: {
          [EXT_ID]: {
            path: '/Users/example/dev/browser-bridge/packages/extension',
          },
        },
      },
    });

    expect(
      __private__.extractBrowserBridgeIdsFromSecurePreferences(raw)
    ).toEqual([EXT_ID]);
  });

  it('includes alternate Chrome channel roots on macOS', () => {
    expect(
      __private__.collectRootDirectories('darwin', {}, '/Users/example')
    ).toEqual(
      expect.arrayContaining([
        '/Users/example/Library/Application Support/Google/Chrome',
        '/Users/example/Library/Application Support/Google/Chrome Beta',
        '/Users/example/Library/Application Support/Google/Chrome Dev',
        '/Users/example/Library/Application Support/Google/Chrome Canary',
        '/Users/example/Library/Application Support/Google/Chrome for Testing',
      ])
    );
  });

  it('prefers connected runtime id discovery', async () => {
    const createCoreClient = vi.fn(() => ({
      post: vi.fn(async () => ({
        ok: true,
        result: {
          extension: {
            connected: true,
            extension_id: EXT_ID,
          },
        },
      })),
    }));

    const result = await discoverActivationExtensionId(
      {
        host: '127.0.0.1',
        port: 3210,
      } as never,
      {
        createCoreClient,
        existsSync: vi.fn(() => false) as never,
        readFileSync: vi.fn() as never,
        readdirSync: vi.fn(() => []) as never,
      }
    );

    expect(result).toEqual({
      kind: 'resolved',
      extensionId: EXT_ID,
      source: 'connected',
      searchedPaths: [],
    });
  });

  it('retries connected discovery when health reports connected before extension id', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: {
          extension: {
            connected: true,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          extension: {
            connected: true,
            extension_id: EXT_ID,
          },
        },
      });
    const createCoreClient = vi.fn(() => ({ post }));
    const sleepMs = vi.fn(async () => {});

    const result = await discoverActivationExtensionId(
      {
        host: '127.0.0.1',
        port: 3210,
      } as never,
      {
        createCoreClient,
        existsSync: vi.fn(() => false) as never,
        readFileSync: vi.fn() as never,
        readdirSync: vi.fn(() => []) as never,
        sleepMs,
      }
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: 'resolved',
      extensionId: EXT_ID,
      source: 'connected',
      searchedPaths: [],
    });
  });

  it('checks multiple runtimes before falling back to profile discovery', async () => {
    const createCoreClient = vi
      .fn()
      .mockImplementationOnce(() => ({
        post: vi.fn(async () => ({
          ok: true,
          result: {
            extension: {
              connected: false,
            },
          },
        })),
      }))
      .mockImplementationOnce(() => ({
        post: vi.fn(async () => ({
          ok: true,
          result: {
            extension: {
              connected: true,
              extension_id: EXT_ID,
            },
          },
        })),
      }));

    const result = await discoverActivationExtensionId(
      [
        {
          host: '127.0.0.1',
          port: 4151,
        },
        {
          host: '127.0.0.1',
          port: 3210,
        },
      ] as never,
      {
        createCoreClient,
        existsSync: vi.fn(() => false) as never,
        readFileSync: vi.fn() as never,
        readdirSync: vi.fn(() => []) as never,
      }
    );

    expect(createCoreClient).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      kind: 'resolved',
      extensionId: EXT_ID,
      source: 'connected',
      searchedPaths: [],
    });
  });

  it('returns deterministic ambiguity when connected runtimes expose different extension ids', async () => {
    const idA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const idB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const createCoreClient = vi
      .fn()
      .mockImplementationOnce(() => ({
        post: vi.fn(async () => ({
          ok: true,
          result: {
            extension: {
              connected: true,
              extension_id: idA,
            },
          },
        })),
      }))
      .mockImplementationOnce(() => ({
        post: vi.fn(async () => ({
          ok: true,
          result: {
            extension: {
              connected: true,
              extension_id: idB,
            },
          },
        })),
      }));

    const result = await discoverActivationExtensionId(
      [
        {
          host: '127.0.0.1',
          port: 4151,
        },
        {
          host: '127.0.0.1',
          port: 3210,
        },
      ] as never,
      {
        createCoreClient,
        existsSync: vi.fn(() => false) as never,
        readFileSync: vi.fn() as never,
        readdirSync: vi.fn(() => []) as never,
      }
    );

    expect(result).toEqual({
      kind: 'ambiguous',
      candidates: [idA, idB],
      searchedPaths: [],
    });
  });

  it('discovers single profile extension id when connected id is unavailable', async () => {
    const readFileSync = vi.fn((path: string) => {
      if (path.endsWith('/Secure Preferences')) {
        return JSON.stringify({
          extensions: {
            settings: {
              [EXT_ID]: {
                manifest: {
                  name: 'Browser Bridge',
                },
              },
            },
          },
        });
      }
      throw new Error('missing');
    });

    const existsSync = vi.fn(
      (path: string) =>
        path.includes('/Google/Chrome') || path.endsWith('/Secure Preferences')
    );

    const result = await discoverActivationExtensionId(
      {
        host: '127.0.0.1',
        port: 3210,
      } as never,
      {
        platform: 'darwin',
        env: {},
        homeDir: '/Users/example',
        createCoreClient: vi.fn(() => ({
          post: vi.fn(async () => {
            throw new Error('no core');
          }),
        })) as never,
        existsSync: existsSync as never,
        readFileSync: readFileSync as never,
        readdirSync: vi.fn(() => [dirent('Profile 1')]) as never,
      }
    );

    expect(result.kind).toBe('resolved');
    expect(result).toMatchObject({
      extensionId: EXT_ID,
      source: 'profile',
    });
  });

  it('returns deterministic ambiguity when multiple profile ids are found', async () => {
    const idA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const idB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const readFileSync = vi.fn((path: string) => {
      if (path.includes('Profile 1')) {
        return JSON.stringify({
          extensions: {
            settings: {
              [idB]: {
                manifest: { name: 'Browser Bridge' },
              },
            },
          },
        });
      }

      if (path.includes('Profile 2')) {
        return JSON.stringify({
          extensions: {
            settings: {
              [idA]: {
                manifest: { name: 'Browser Bridge' },
              },
            },
          },
        });
      }

      return '{}';
    });

    const result = await discoverActivationExtensionId(
      {
        host: '127.0.0.1',
        port: 3210,
      } as never,
      {
        platform: 'darwin',
        env: {},
        homeDir: '/Users/example',
        createCoreClient: vi.fn(() => ({
          post: vi.fn(async () => ({ ok: true, result: {} })),
        })) as never,
        existsSync: vi.fn(() => true) as never,
        readFileSync: readFileSync as never,
        readdirSync: vi.fn(() => [
          dirent('Profile 1'),
          dirent('Profile 2'),
        ]) as never,
      }
    );

    expect(result).toEqual({
      kind: 'ambiguous',
      candidates: [idA, idB],
      searchedPaths: expect.any(Array),
    });
  });
});
