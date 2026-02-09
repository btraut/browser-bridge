import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSION_PROMPT_WAIT_MS,
  PERMISSION_PROMPT_WAIT_MS_KEY,
  SITE_ALLOWLIST_KEY,
  allowSiteAlways,
  getAllowlistedSites,
  isSiteAllowed,
  readPermissionPromptWaitMs,
  revokeSite,
  siteKeyFromUrl,
  touchSiteLastUsed,
  upsertAllowlistedSites,
} from './site-permissions';

type ChromeStorageLike = {
  storage: {
    local: {
      get: (
        keys: string[],
        cb: (result: Record<string, unknown>) => void
      ) => void;
      set: (value: Record<string, unknown>, cb: () => void) => void;
    };
  };
};

const installFakeChromeStorage = (): {
  store: Record<string, unknown>;
  uninstall: () => void;
} => {
  const store: Record<string, unknown> = {};

  const chromeLike: ChromeStorageLike = {
    storage: {
      local: {
        get: (keys, cb) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            out[k] = store[k];
          }
          cb(out);
        },
        set: (value, cb) => {
          Object.assign(store, value);
          cb();
        },
      },
    },
  };

  const prev = (globalThis as unknown as { chrome?: unknown }).chrome;
  (globalThis as unknown as { chrome: unknown }).chrome = chromeLike;

  return {
    store,
    uninstall: () => {
      if (prev === undefined) {
        delete (globalThis as unknown as { chrome?: unknown }).chrome;
      } else {
        (globalThis as unknown as { chrome: unknown }).chrome = prev;
      }
    },
  };
};

describe('site permissions', () => {
  let store: Record<string, unknown>;
  let uninstall: () => void;

  beforeEach(() => {
    ({ store, uninstall } = installFakeChromeStorage());
  });

  afterEach(() => {
    uninstall();
  });

  it('normalizes url -> site key (hostname[:port])', () => {
    expect(siteKeyFromUrl('https://example.com/a/b')).toBe('example.com');
    expect(siteKeyFromUrl('http://localhost:3000/')).toBe('localhost:3000');
    expect(siteKeyFromUrl('file:///Users/me/test.html')).toBeNull();
    expect(siteKeyFromUrl('chrome://extensions')).toBeNull();
  });

  it('creates and updates allowlist entries', async () => {
    const t1 = new Date('2026-02-08T00:00:00.000Z');
    const t2 = new Date('2026-02-08T00:00:10.000Z');

    await allowSiteAlways('Example.COM', t1);
    expect(await isSiteAllowed('example.com')).toBe(true);

    const first = await getAllowlistedSites();
    expect(first['example.com']?.createdAt).toBe(t1.toISOString());
    expect(first['example.com']?.lastUsedAt).toBe(t1.toISOString());

    await allowSiteAlways('example.com', t2);
    const second = await getAllowlistedSites();
    expect(second['example.com']?.createdAt).toBe(t1.toISOString());
    expect(second['example.com']?.lastUsedAt).toBe(t2.toISOString());
  });

  it('touches lastUsedAt only for existing entries', async () => {
    const t1 = new Date('2026-02-08T00:00:00.000Z');
    const t2 = new Date('2026-02-08T00:00:10.000Z');

    await touchSiteLastUsed('example.com', t1);
    expect(await getAllowlistedSites()).toEqual({});

    await allowSiteAlways('example.com', t1);
    await touchSiteLastUsed('example.com', t2);
    const allowlist = await getAllowlistedSites();
    expect(allowlist['example.com']?.lastUsedAt).toBe(t2.toISOString());
  });

  it('revokes sites', async () => {
    await allowSiteAlways('example.com', new Date('2026-02-08T00:00:00.000Z'));
    await revokeSite('example.com');
    expect(await isSiteAllowed('example.com')).toBe(false);
  });

  it('supports undo-style restore helpers', async () => {
    await allowSiteAlways('example.com', new Date('2026-02-08T00:00:00.000Z'));
    await allowSiteAlways(
      'localhost:3000',
      new Date('2026-02-08T00:00:10.000Z')
    );

    const before = await getAllowlistedSites();
    expect(Object.keys(before).sort()).toEqual([
      'example.com',
      'localhost:3000',
    ]);

    await revokeSite('EXAMPLE.com');
    expect(await isSiteAllowed('example.com')).toBe(false);

    // Restore only the removed entry.
    await upsertAllowlistedSites({ 'example.com': before['example.com']! });
    expect(await isSiteAllowed('example.com')).toBe(true);
  });

  it('reads permission prompt wait config with defaults', async () => {
    expect(await readPermissionPromptWaitMs()).toBe(
      DEFAULT_PERMISSION_PROMPT_WAIT_MS
    );

    store[PERMISSION_PROMPT_WAIT_MS_KEY] = '12000';
    expect(await readPermissionPromptWaitMs()).toBe(12000);

    store[PERMISSION_PROMPT_WAIT_MS_KEY] = 5000;
    expect(await readPermissionPromptWaitMs()).toBe(5000);

    store[PERMISSION_PROMPT_WAIT_MS_KEY] = 'nope';
    expect(await readPermissionPromptWaitMs()).toBe(
      DEFAULT_PERMISSION_PROMPT_WAIT_MS
    );

    store[SITE_ALLOWLIST_KEY] = {
      'bad-entry': { createdAt: 1, lastUsedAt: 2 },
    };
    expect(await getAllowlistedSites()).toEqual({});
  });
});
