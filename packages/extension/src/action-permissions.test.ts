import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gateDriveAction } from './action-permissions';

const mockedSitePermissions = vi.hoisted(() => ({
  allowSiteAlways: vi.fn(),
  isSiteAllowed: vi.fn(),
  readSitePermissionsMode: vi.fn(),
  siteKeyFromUrl: vi.fn(),
}));

const mockedRestrictedUrl = vi.hoisted(() => ({
  isRestrictedUrl: vi.fn(),
  buildRestrictedUrlError: vi.fn(),
}));

vi.mock('./site-permissions.js', () => ({
  allowSiteAlways: mockedSitePermissions.allowSiteAlways,
  isSiteAllowed: mockedSitePermissions.isSiteAllowed,
  readSitePermissionsMode: mockedSitePermissions.readSitePermissionsMode,
  siteKeyFromUrl: mockedSitePermissions.siteKeyFromUrl,
}));

vi.mock('./restricted-url.js', () => ({
  isRestrictedUrl: mockedRestrictedUrl.isRestrictedUrl,
  buildRestrictedUrlError: mockedRestrictedUrl.buildRestrictedUrlError,
}));

describe('gateDriveAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSitePermissions.readSitePermissionsMode.mockResolvedValue('granular');
    mockedSitePermissions.isSiteAllowed.mockResolvedValue(false);
    mockedSitePermissions.siteKeyFromUrl.mockImplementation((url: string) =>
      url.startsWith('https://') ? 'example.com' : null
    );
    mockedRestrictedUrl.isRestrictedUrl.mockReturnValue(false);
    mockedRestrictedUrl.buildRestrictedUrlError.mockReturnValue({
      code: 'NOT_SUPPORTED',
      message: 'restricted',
      retryable: false,
    });
  });

  it('skips ungated actions', async () => {
    await expect(
      gateDriveAction({
        action: 'drive.tab_list',
        params: {},
        getDefaultTabId: async () => 1,
        getTab: async () => ({ url: 'https://example.com' }),
        permissionPrompts: {
          requestPermission: async () => ({ kind: 'allow_once' }),
        },
      })
    ).resolves.toEqual({
      ok: true,
      siteKey: null,
      touchOnSuccess: false,
    });
  });

  it('uses the resolved default tab for non-navigate actions', async () => {
    const getDefaultTabId = vi.fn(async () => 7);
    const getTab = vi.fn(async () => ({ url: 'https://example.com/path' }));

    await expect(
      gateDriveAction({
        action: 'drive.click',
        params: {},
        getDefaultTabId,
        getTab,
        permissionPrompts: {
          requestPermission: async () => ({ kind: 'allow_once' }),
        },
      })
    ).resolves.toEqual({
      ok: true,
      siteKey: 'example.com',
      touchOnSuccess: false,
    });

    expect(getDefaultTabId).toHaveBeenCalledTimes(1);
    expect(getTab).toHaveBeenCalledWith(7);
  });

  it('persists allow-always decisions', async () => {
    await expect(
      gateDriveAction({
        action: 'drive.navigate',
        params: { url: 'https://example.com' },
        getDefaultTabId: async () => 1,
        getTab: async () => ({ url: 'https://example.com' }),
        permissionPrompts: {
          requestPermission: async () => ({ kind: 'allow_always' }),
        },
      })
    ).resolves.toEqual({
      ok: true,
      siteKey: 'example.com',
      touchOnSuccess: true,
    });

    expect(mockedSitePermissions.allowSiteAlways).toHaveBeenCalledWith(
      'example.com'
    );
  });

  it('returns restricted-url errors directly', async () => {
    mockedRestrictedUrl.isRestrictedUrl.mockReturnValue(true);

    await expect(
      gateDriveAction({
        action: 'drive.navigate',
        params: { url: 'chrome://settings' },
        getDefaultTabId: async () => 1,
        getTab: async () => ({ url: 'chrome://settings' }),
        permissionPrompts: {
          requestPermission: async () => ({ kind: 'allow_once' }),
        },
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'restricted',
        retryable: false,
      },
    });
  });
});
