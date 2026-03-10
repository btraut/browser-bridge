export const SITE_ALLOWLIST_KEY = 'siteAllowlist';
export const PERMISSION_PROMPT_WAIT_MS_KEY = 'permissionPromptWaitMs';
export const DEFAULT_PERMISSION_PROMPT_WAIT_MS = 30_000;
export const SITE_PERMISSIONS_MODE_KEY = 'sitePermissionsMode';
export const DEBUGGER_CAPABILITY_ENABLED_KEY = 'debuggerCapabilityEnabled';

export type SitePermissionsMode = 'granular' | 'bypass';
export const DEFAULT_SITE_PERMISSIONS_MODE: SitePermissionsMode = 'granular';
export const DEFAULT_DEBUGGER_CAPABILITY_ENABLED = true;

export type SiteAllowlistEntry = {
  createdAt: string; // ISO
  lastUsedAt: string; // ISO
};

export type SiteAllowlist = Record<string, SiteAllowlistEntry>;

export const siteKeyFromUrl = (rawUrl: string): string | null => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    // Only gate "real web" pages for now.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // URL.hostname is lowercased by the platform.
    if (!parsed.hostname) {
      return null;
    }

    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return null;
  }
};

const isAllowlistEntry = (value: unknown): value is SiteAllowlistEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.createdAt === 'string' && typeof v.lastUsedAt === 'string';
};

const normalizeSiteKey = (siteKey: string): string => siteKey.toLowerCase();

const readAllowlistRaw = async (): Promise<SiteAllowlist> => {
  return await new Promise<SiteAllowlist>((resolve) => {
    chrome.storage.local.get(
      [SITE_ALLOWLIST_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[SITE_ALLOWLIST_KEY];
        if (!raw || typeof raw !== 'object') {
          resolve({});
          return;
        }

        const out: SiteAllowlist = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof k !== 'string') {
            continue;
          }
          if (!isAllowlistEntry(v)) {
            continue;
          }
          out[normalizeSiteKey(k)] = v;
        }

        resolve(out);
      }
    );
  });
};

const writeAllowlistRaw = async (allowlist: SiteAllowlist): Promise<void> => {
  return await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [SITE_ALLOWLIST_KEY]: allowlist }, () =>
      resolve()
    );
  });
};

export const readSitePermissionsMode =
  async (): Promise<SitePermissionsMode> => {
    return await new Promise<SitePermissionsMode>((resolve) => {
      chrome.storage.local.get(
        [SITE_PERMISSIONS_MODE_KEY],
        (result: Record<string, unknown>) => {
          const raw = result?.[SITE_PERMISSIONS_MODE_KEY];
          if (raw === 'granular' || raw === 'bypass') {
            resolve(raw);
            return;
          }

          // Self-heal legacy/invalid storage to a safe default, so UIs never
          // render with "no mode selected" and other callers don't have to
          // special-case missing values.
          try {
            chrome.storage.local.set({
              [SITE_PERMISSIONS_MODE_KEY]: DEFAULT_SITE_PERMISSIONS_MODE,
            });
          } catch {
            // ignore
          }
          resolve(DEFAULT_SITE_PERMISSIONS_MODE);
        }
      );
    });
  };

export const writeSitePermissionsMode = async (
  mode: SitePermissionsMode
): Promise<void> => {
  return await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [SITE_PERMISSIONS_MODE_KEY]: mode }, () =>
      resolve()
    );
  });
};

export const readPermissionPromptWaitMs = async (): Promise<number> => {
  return await new Promise<number>((resolve) => {
    chrome.storage.local.get(
      [PERMISSION_PROMPT_WAIT_MS_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[PERMISSION_PROMPT_WAIT_MS_KEY];
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
          resolve(raw);
          return;
        }
        if (typeof raw === 'string') {
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed > 0) {
            resolve(parsed);
            return;
          }
        }

        resolve(DEFAULT_PERMISSION_PROMPT_WAIT_MS);
      }
    );
  });
};

export const readDebuggerCapabilityEnabled = async (): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    chrome.storage.local.get(
      [DEBUGGER_CAPABILITY_ENABLED_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[DEBUGGER_CAPABILITY_ENABLED_KEY];
        if (raw === true) {
          resolve(true);
          return;
        }

        // Inspect is always enabled now; self-heal any legacy false/missing
        // values so older installs stop carrying the dead toggle around.
        try {
          chrome.storage.local.set({
            [DEBUGGER_CAPABILITY_ENABLED_KEY]:
              DEFAULT_DEBUGGER_CAPABILITY_ENABLED,
          });
        } catch {
          // ignore
        }
        resolve(DEFAULT_DEBUGGER_CAPABILITY_ENABLED);
      }
    );
  });
};

export const writeDebuggerCapabilityEnabled = async (
  enabled: boolean
): Promise<void> => {
  void enabled;
  return await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [DEBUGGER_CAPABILITY_ENABLED_KEY]: true }, () =>
      resolve()
    );
  });
};

export const getAllowlistedSites = async (): Promise<SiteAllowlist> => {
  return await readAllowlistRaw();
};

export const isSiteAllowed = async (siteKey: string): Promise<boolean> => {
  const key = normalizeSiteKey(siteKey);
  const allowlist = await readAllowlistRaw();
  return Boolean(allowlist[key]);
};

export const allowSiteAlways = async (
  siteKey: string,
  now: Date = new Date()
): Promise<void> => {
  const key = normalizeSiteKey(siteKey);
  const allowlist = await readAllowlistRaw();
  const nowIso = now.toISOString();

  const existing = allowlist[key];
  allowlist[key] = {
    createdAt: existing?.createdAt ?? nowIso,
    lastUsedAt: nowIso,
  };

  await writeAllowlistRaw(allowlist);
};

export const upsertAllowlistedSites = async (
  entries: SiteAllowlist
): Promise<void> => {
  const allowlist = await readAllowlistRaw();
  let changed = false;

  for (const [k, v] of Object.entries(entries ?? {})) {
    if (typeof k !== 'string') {
      continue;
    }
    if (!isAllowlistEntry(v)) {
      continue;
    }
    allowlist[normalizeSiteKey(k)] = v;
    changed = true;
  }

  if (!changed) {
    return;
  }

  await writeAllowlistRaw(allowlist);
};

export const touchSiteLastUsed = async (
  siteKey: string,
  now: Date = new Date()
): Promise<void> => {
  const key = normalizeSiteKey(siteKey);
  const allowlist = await readAllowlistRaw();
  const existing = allowlist[key];
  if (!existing) {
    return;
  }

  allowlist[key] = { ...existing, lastUsedAt: now.toISOString() };
  await writeAllowlistRaw(allowlist);
};

export const revokeSite = async (siteKey: string): Promise<void> => {
  const key = normalizeSiteKey(siteKey);
  const allowlist = await readAllowlistRaw();
  if (!allowlist[key]) {
    return;
  }
  delete allowlist[key];
  await writeAllowlistRaw(allowlist);
};
