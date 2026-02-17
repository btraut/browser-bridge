import {
  allowSiteAlways,
  DEFAULT_DEBUGGER_CAPABILITY_ENABLED,
  getAllowlistedSites,
  readDebuggerCapabilityEnabled,
  readSitePermissionsMode,
  revokeSite,
  type SitePermissionsMode,
  upsertAllowlistedSites,
  writeDebuggerCapabilityEnabled,
  writeSitePermissionsMode,
} from './site-permissions.js';

type Row = {
  site: string;
  createdAt: string;
  lastUsedAt: string;
};

type ModeEls = {
  granular: HTMLInputElement;
  bypass: HTMLInputElement;
  sitesDetails: HTMLDetailsElement;
  sitesSummary: HTMLElement;
};

type DebuggerEls = {
  enabled: HTMLInputElement;
  status: HTMLElement;
};

const ACTIVATION_FLAG_PARAM = 'bb_activate';
const ACTIVATION_PORT_PARAM = 'corePort';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
};

const elFromHtml = (html: string): HTMLElement => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const node = tpl.content.firstElementChild;
  if (!node) {
    throw new Error('Expected element from template.');
  }
  return node as HTMLElement;
};

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return iso;
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
};

const parseActivationPort = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
};

const clearActivationQueryParams = (): void => {
  const url = new URL(window.location.href);
  if (!url.search) {
    return;
  }
  url.search = '';
  window.history.replaceState(
    null,
    document.title,
    `${url.pathname}${url.hash}`
  );
};

const writeCorePort = async (corePort: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set({ corePort }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
};

const applyActivationQueryParams = async (): Promise<void> => {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  if (params.get(ACTIVATION_FLAG_PARAM) !== '1') {
    return;
  }

  const corePort = parseActivationPort(params.get(ACTIVATION_PORT_PARAM));
  try {
    if (corePort !== null) {
      await writeCorePort(corePort);
    } else {
      console.warn('Ignoring dev activation request with invalid corePort.');
    }
  } catch (error) {
    console.warn('Failed to apply dev activation corePort.', error);
  } finally {
    clearActivationQueryParams();
  }
};

const createToast = (): {
  showUndo: (opts: { message: string; onUndo: () => Promise<void> }) => void;
} => {
  const wrap = document.createElement('div');
  wrap.className = 'bb-toast-wrap';
  document.body.appendChild(wrap);

  let activeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const clear = (): void => {
    if (activeTimer !== null) {
      globalThis.clearTimeout(activeTimer);
      activeTimer = null;
    }
    wrap.innerHTML = '';
  };

  return {
    showUndo: ({ message, onUndo }): void => {
      clear();

      const toast = elFromHtml(`
        <div class="bb-toast" role="status" aria-live="polite">
          <div class="bb-toast-msg"></div>
          <button class="bb-link-button" type="button">Undo</button>
        </div>
      `);
      const msgEl = toast.querySelector('.bb-toast-msg') as HTMLElement | null;
      const undoBtn = toast.querySelector('button') as HTMLButtonElement | null;
      if (!msgEl || !undoBtn) {
        throw new Error('Toast missing required elements.');
      }

      msgEl.textContent = message;
      undoBtn.addEventListener('click', () => {
        undoBtn.disabled = true;
        void (async () => {
          try {
            await onUndo();
          } finally {
            clear();
          }
        })();
      });

      wrap.appendChild(toast);
      activeTimer = globalThis.setTimeout(() => clear(), 6000);
    },
  };
};

const toast = createToast();

const getModeEls = (): ModeEls => {
  const granular = byId('bb-mode-granular') as HTMLInputElement;
  const bypass = byId('bb-mode-bypass') as HTMLInputElement;
  const sitesDetails = byId('bb-sites-details') as HTMLDetailsElement;
  const sitesSummary = byId('bb-sites-summary');

  if (granular.type !== 'radio' || bypass.type !== 'radio') {
    throw new Error('Expected radio inputs for permissions mode.');
  }
  if (sitesDetails.tagName.toLowerCase() !== 'details') {
    throw new Error('Expected a <details> for the sites disclosure.');
  }

  return {
    granular,
    bypass,
    sitesDetails,
    sitesSummary,
  };
};

const getDebuggerEls = (): DebuggerEls => {
  const enabled = byId('bb-debugger-enabled') as HTMLInputElement;
  const status = byId('bb-debugger-status');
  if (enabled.type !== 'checkbox') {
    throw new Error('Expected checkbox input for debugger capability.');
  }
  return { enabled, status };
};

let lastMode: SitePermissionsMode | null = null;
let modeWriteInProgress = false;
let debuggerWriteInProgress = false;

const applyMode = (mode: SitePermissionsMode): void => {
  const els = getModeEls();
  els.granular.checked = mode === 'granular';
  els.bypass.checked = mode === 'bypass';

  // Always show the disclosure + allowlist UI in both modes.
  els.sitesSummary.textContent = 'Approved sites';
  if (mode === 'bypass') {
    if (lastMode !== 'bypass') {
      els.sitesDetails.open = false;
    }
  } else if (lastMode !== 'granular') {
    els.sitesDetails.open = true;
  }

  lastMode = mode;
};

const refreshMode = async (): Promise<void> => {
  applyMode(await readSitePermissionsMode());
};

const applyDebuggerCapability = (enabled: boolean): void => {
  const els = getDebuggerEls();
  els.enabled.checked = enabled;
  els.status.textContent = enabled
    ? 'Enabled. inspect tools can attach through the debugger bridge.'
    : 'Disabled by default. Enable only when you need inspect tools.';
};

const refreshDebuggerCapability = async (): Promise<void> => {
  applyDebuggerCapability(await readDebuggerCapabilityEnabled());
};

const focusSiteRow = (site: string): void => {
  const container = byId('bb-sites');
  const rows = Array.from(container.querySelectorAll('.bb-site-row'));
  for (const rowEl of rows) {
    const el = rowEl as HTMLElement;
    if (el.dataset.site !== site) {
      continue;
    }

    try {
      el.scrollIntoView({ block: 'nearest' });
    } catch {
      // ignore
    }

    const btn = el.querySelector('button') as HTMLButtonElement | null;
    btn?.focus();
    return;
  }
};

const render = (rows: Row[]): void => {
  const container = byId('bb-sites');
  container.innerHTML = '';
  container.hidden = false;

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bb-site-empty';

    const line1 = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'No approved sites yet.';
    line1.appendChild(title);
    empty.appendChild(line1);

    const line2 = document.createElement('div');
    line2.textContent =
      'Sites show up here after you approve them in a permission prompt.';
    empty.appendChild(line2);
    container.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const item = elFromHtml(`
      <div class="bb-site-row" role="listitem">
        <div class="bb-site-main">
            <div class="bb-site-key"></div>
            <div class="bb-site-meta"></div>
        </div>
        <button class="bb-link-button bb-link-button-danger" type="button">
          Revoke
        </button>
      </div>
    `);
    (item as HTMLElement).dataset.site = row.site;

    const key = item.querySelector('.bb-site-key') as HTMLElement | null;
    const meta = item.querySelector('.bb-site-meta') as HTMLElement | null;
    const revokeBtn = item.querySelector('button') as HTMLButtonElement | null;
    if (!key || !meta || !revokeBtn) {
      throw new Error('List row missing required elements.');
    }

    key.textContent = row.site;
    meta.textContent = `Last used: ${formatTime(row.lastUsedAt)}`;
    meta.title = `Approved: ${formatTime(
      row.createdAt
    )}\nLast used: ${formatTime(row.lastUsedAt)}`;

    revokeBtn.addEventListener('click', () => {
      revokeBtn.disabled = true;
      void (async () => {
        const before = await getAllowlistedSites();
        const entry = before[row.site] ?? before[row.site.toLowerCase()];

        try {
          await revokeSite(row.site);
        } finally {
          await refresh();
          revokeBtn.disabled = false;
        }

        if (entry) {
          toast.showUndo({
            message: `Revoked ${row.site}.`,
            onUndo: async () => {
              try {
                await upsertAllowlistedSites({ [row.site]: entry });
                const after = await getAllowlistedSites();
                if (!after[row.site] && !after[row.site.toLowerCase()]) {
                  await allowSiteAlways(row.site);
                }
              } catch (err) {
                // If restore fails for any reason, fall back to re-adding the site.
                // This preserves the intended user outcome even if timestamps change.
                console.warn(
                  'Undo revoke failed; falling back to allowSiteAlways.',
                  err
                );
                await allowSiteAlways(row.site);
              }
              await refresh();
              focusSiteRow(row.site);
            },
          });
        }
      })();
    });

    container.appendChild(item);
  }
};

const refresh = async (): Promise<void> => {
  const allowlist = await getAllowlistedSites();
  const rows: Row[] = Object.entries(allowlist).map(([site, entry]) => ({
    site,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
  }));

  rows.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  render(rows);
};

const setMode = async (mode: SitePermissionsMode): Promise<void> => {
  if (modeWriteInProgress) {
    return;
  }

  modeWriteInProgress = true;
  try {
    await writeSitePermissionsMode(mode);
    applyMode(mode);
    await refresh();
  } finally {
    modeWriteInProgress = false;
  }
};

const setDebuggerCapability = async (enabled: boolean): Promise<void> => {
  if (debuggerWriteInProgress) {
    return;
  }

  debuggerWriteInProgress = true;
  try {
    await writeDebuggerCapabilityEnabled(enabled);
    applyDebuggerCapability(enabled);
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage({ action: 'drive.refresh_capabilities' }, () =>
        resolve()
      );
    });
  } catch {
    applyDebuggerCapability(DEFAULT_DEBUGGER_CAPABILITY_ENABLED);
  } finally {
    debuggerWriteInProgress = false;
  }
};

const refreshAll = async (): Promise<void> => {
  // Mode impacts how we want to render the empty state, so apply it first.
  await refreshMode();
  await refreshDebuggerCapability();
  await refresh();
};

const main = (): void => {
  void (async () => {
    await applyActivationQueryParams();
    await refreshAll();
  })();

  const { granular, bypass } = getModeEls();
  const { enabled } = getDebuggerEls();
  granular.addEventListener('change', () => {
    if (!granular.checked) {
      return;
    }
    void setMode('granular');
  });
  bypass.addEventListener('change', () => {
    if (!bypass.checked) {
      return;
    }
    void setMode('bypass');
  });
  enabled.addEventListener('change', () => {
    void setDebuggerCapability(enabled.checked);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chrome as any).storage?.onChanged?.addListener?.(() => {
    void refreshAll();
  });
};

main();
