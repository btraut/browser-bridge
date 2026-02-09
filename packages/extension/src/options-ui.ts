import {
  getAllowlistedSites,
  revokeSites,
  setAllowlistedSites,
  upsertAllowlistedSites,
} from './site-permissions.js';

type Row = {
  site: string;
  createdAt: string;
  lastUsedAt: string;
};

type SortMode = 'last_used' | 'alpha' | 'created';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
};

const parseIso = (iso: string): Date | null => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return null;
  }
  return d;
};

const formatAbsolute = (d: Date, withSeconds: boolean): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
    }).format(d);
  } catch {
    return d.toISOString();
  }
};

const formatRelative = (d: Date, now: Date): string => {
  const deltaMs = now.getTime() - d.getTime();
  const deltaSec = Math.round(deltaMs / 1000);
  if (deltaSec < 15) return 'just now';
  if (deltaSec < 90) return '1 min ago';
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr} hr ago`;
  const deltaDay = Math.round(deltaHr / 24);
  if (deltaDay === 1) return '1 day ago';
  if (deltaDay < 31) return `${deltaDay} days ago`;

  // Past the "recently used" horizon, use a short absolute date (no seconds).
  return formatAbsolute(d, false);
};

const ACTIONS_LABEL = 'browse, click, type';

const elFromHtml = (html: string): HTMLElement => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const node = tpl.content.firstElementChild;
  if (!node) {
    throw new Error('Expected element from template.');
  }
  return node as HTMLElement;
};

const createConfirmDialog = (): {
  confirm: (opts: {
    title: string;
    body: string;
    confirmText: string;
  }) => Promise<boolean>;
} => {
  // Fallback for environments without <dialog>.
  if (
    typeof (globalThis as unknown as { HTMLDialogElement?: unknown })
      .HTMLDialogElement === 'undefined'
  ) {
    return {
      confirm: async ({ title, body }): Promise<boolean> => {
        return globalThis.confirm(`${title}\n\n${body}`);
      },
    };
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'bb-dialog';
  dialog.appendChild(
    elFromHtml(`
      <form method="dialog" class="bb-dialog-inner">
        <h2 class="bb-dialog-title" id="bb-dialog-title"></h2>
        <p class="bb-dialog-body" id="bb-dialog-body"></p>
        <div class="bb-dialog-actions">
          <button class="bb-button bb-button-secondary" value="cancel" type="submit" id="bb-dialog-cancel">Cancel</button>
          <button class="bb-button bb-button-danger" value="confirm" type="submit" id="bb-dialog-confirm">Confirm</button>
        </div>
      </form>
    `)
  );
  document.body.appendChild(dialog);

  const titleEl = dialog.querySelector(
    '#bb-dialog-title'
  ) as HTMLElement | null;
  const bodyEl = dialog.querySelector('#bb-dialog-body') as HTMLElement | null;
  const confirmBtn = dialog.querySelector(
    '#bb-dialog-confirm'
  ) as HTMLButtonElement | null;
  if (!titleEl || !bodyEl || !confirmBtn) {
    throw new Error('Confirm dialog missing required elements.');
  }

  return {
    confirm: async ({ title, body, confirmText }): Promise<boolean> => {
      titleEl.textContent = title;
      bodyEl.textContent = body;
      confirmBtn.textContent = confirmText;

      dialog.showModal();
      const choice = await new Promise<string>((resolve) => {
        const onClose = (): void => {
          dialog.removeEventListener('close', onClose);
          resolve(dialog.returnValue || 'cancel');
        };
        dialog.addEventListener('close', onClose);
      });
      return choice === 'confirm';
    },
  };
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

const buildUi = (
  root: HTMLElement
): {
  search: HTMLInputElement;
  sort: HTMLSelectElement;
  selectAll: HTMLInputElement;
  count: HTMLElement;
  revokeSelected: HTMLButtonElement;
  revokeAll: HTMLButtonElement;
  list: HTMLElement;
  empty: HTMLElement;
} => {
  root.innerHTML = '';

  const toolbar = elFromHtml(`
    <div class="bb-toolbar" role="region" aria-label="Approved sites controls">
      <div class="bb-toolbar-left">
        <label class="bb-field">
          <span class="bb-field-label">Search</span>
          <input class="bb-input" type="search" placeholder="Search sites" autocomplete="off" />
        </label>
        <label class="bb-field">
          <span class="bb-field-label">Sort</span>
          <select class="bb-select">
            <option value="last_used">Last used</option>
            <option value="alpha">Alphabetical</option>
            <option value="created">Recently added</option>
          </select>
        </label>
        <label class="bb-check">
          <input class="bb-checkbox" type="checkbox" />
          <span>Select visible</span>
        </label>
        <div class="bb-count" aria-live="polite"></div>
      </div>
      <div class="bb-toolbar-right">
        <button class="bb-button bb-button-secondary" type="button" disabled>Revoke selected</button>
        <button class="bb-button bb-button-danger" type="button" disabled>Revoke all</button>
      </div>
    </div>
  `);

  const list = document.createElement('div');
  list.className = 'bb-list';
  list.setAttribute('role', 'list');

  const empty = elFromHtml(
    `<div class="bb-empty">No approved sites yet.</div>`
  );

  root.appendChild(toolbar);
  root.appendChild(list);
  root.appendChild(empty);

  const search = toolbar.querySelector(
    'input[type="search"]'
  ) as HTMLInputElement | null;
  const sort = toolbar.querySelector('select') as HTMLSelectElement | null;
  const selectAll = toolbar.querySelector(
    'input[type="checkbox"]'
  ) as HTMLInputElement | null;
  const count = toolbar.querySelector('.bb-count') as HTMLElement | null;
  const buttons = toolbar.querySelectorAll('button');
  const revokeSelected = buttons[0] as HTMLButtonElement | undefined;
  const revokeAll = buttons[1] as HTMLButtonElement | undefined;
  if (
    !search ||
    !sort ||
    !selectAll ||
    !count ||
    !revokeSelected ||
    !revokeAll
  ) {
    throw new Error('Options UI missing required controls.');
  }

  return {
    search,
    sort,
    selectAll,
    count,
    revokeSelected,
    revokeAll,
    list,
    empty,
  };
};

const normalizeQuery = (q: string): string => q.trim().toLowerCase();

const applySort = (rows: Row[], mode: SortMode): Row[] => {
  const out = [...rows];
  if (mode === 'alpha') {
    out.sort((a, b) => a.site.localeCompare(b.site));
    return out;
  }
  if (mode === 'created') {
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }
  out.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  return out;
};

const filterRows = (rows: Row[], q: string): Row[] => {
  const query = normalizeQuery(q);
  if (!query) return rows;
  return rows.filter((r) => r.site.toLowerCase().includes(query));
};

const confirmUi = createConfirmDialog();
const toastUi = createToast();

let allRows: Row[] = [];
let ui: ReturnType<typeof buildUi> | null = null;
let sortMode: SortMode = 'last_used';
let searchQuery = '';
let selected = new Set<string>();

const render = (viewRows: Row[]): void => {
  if (!ui) {
    ui = buildUi(byId('bb-sites'));
    ui.search.addEventListener('input', () => {
      searchQuery = ui!.search.value;
      renderCurrent();
    });
    ui.sort.addEventListener('change', () => {
      sortMode = ui!.sort.value as SortMode;
      renderCurrent();
    });
    ui.selectAll.addEventListener('change', () => {
      const visible = viewKeys();
      if (ui!.selectAll.checked) {
        for (const k of visible) selected.add(k);
      } else {
        for (const k of visible) selected.delete(k);
      }
      renderCurrent();
    });

    ui.revokeSelected.addEventListener('click', () => void revokeSelected());
    ui.revokeAll.addEventListener('click', () => void revokeAll());
  }

  const now = new Date();
  const allowlistCount = allRows.length;
  ui.count.textContent = `${allowlistCount} ${allowlistCount === 1 ? 'site' : 'sites'}`;

  // Keep selection in sync with known sites.
  const existingKeys = new Set(allRows.map((r) => r.site));
  selected = new Set([...selected].filter((k) => existingKeys.has(k)));

  const visibleKeys = viewRows.map((r) => r.site);
  const selectedVisible = visibleKeys.filter((k) => selected.has(k)).length;
  ui.selectAll.checked =
    visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
  ui.selectAll.indeterminate =
    selectedVisible > 0 && selectedVisible < visibleKeys.length;

  ui.revokeSelected.disabled = selected.size === 0;
  ui.revokeAll.disabled = allRows.length === 0;

  ui.list.innerHTML = '';
  if (viewRows.length === 0) {
    ui.empty.style.display = '';
    ui.list.style.display = 'none';
    return;
  }

  ui.empty.style.display = 'none';
  ui.list.style.display = '';

  for (const row of viewRows) {
    const entryLastUsed = parseIso(row.lastUsedAt);
    const entryCreated = parseIso(row.createdAt);

    const metaTitleParts: string[] = [];
    if (entryLastUsed)
      metaTitleParts.push(`Last used: ${formatAbsolute(entryLastUsed, true)}`);
    if (entryCreated)
      metaTitleParts.push(`Created: ${formatAbsolute(entryCreated, true)}`);
    const metaTitle = metaTitleParts.join('\n');

    const lastUsedText = entryLastUsed
      ? formatRelative(entryLastUsed, now)
      : row.lastUsedAt;

    const item = elFromHtml(`
      <div class="bb-list-row" role="listitem">
        <div class="bb-list-left">
          <input class="bb-checkbox" type="checkbox" />
          <div class="bb-list-main">
            <div class="bb-site-key"></div>
            <div class="bb-list-meta"></div>
          </div>
        </div>
        <div class="bb-list-right">
          <button class="bb-link-button bb-link-button-danger" type="button">Revoke</button>
        </div>
      </div>
    `);

    const check = item.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement | null;
    const key = item.querySelector('.bb-site-key') as HTMLElement | null;
    const meta = item.querySelector('.bb-list-meta') as HTMLElement | null;
    const revokeBtn = item.querySelector('button') as HTMLButtonElement | null;
    if (!check || !key || !meta || !revokeBtn) {
      throw new Error('List row missing required elements.');
    }

    check.checked = selected.has(row.site);
    check.setAttribute('aria-label', `Select ${row.site}`);
    check.addEventListener('change', () => {
      if (check.checked) selected.add(row.site);
      else selected.delete(row.site);
      renderCurrent();
    });

    key.textContent = row.site;
    meta.textContent = `Last used: ${lastUsedText} - Actions: ${ACTIONS_LABEL}`;
    if (metaTitle) {
      meta.title = metaTitle;
    }

    revokeBtn.addEventListener('click', () => void revokeOne(row.site));

    ui.list.appendChild(item);
  }
};

const viewKeys = (): string[] => {
  const viewRows = applySort(filterRows(allRows, searchQuery), sortMode);
  return viewRows.map((r) => r.site);
};

const renderCurrent = (): void => {
  if (!ui) {
    render(applySort(filterRows(allRows, searchQuery), sortMode));
    return;
  }
  // Keep controls stable even when external storage updates occur.
  if (ui.search.value !== searchQuery) ui.search.value = searchQuery;
  if (ui.sort.value !== sortMode) ui.sort.value = sortMode;
  render(applySort(filterRows(allRows, searchQuery), sortMode));
};

const revokeOne = async (site: string): Promise<void> => {
  const ok = await confirmUi.confirm({
    title: 'Revoke site access?',
    body: `Browser Bridge will no longer be allowed to take actions on:\n${site}`,
    confirmText: 'Revoke',
  });
  if (!ok) return;

  const before = await getAllowlistedSites();
  const entry = before[site.toLowerCase()];

  await revokeSites([site]);
  selected.delete(site);
  await refresh();

  if (entry) {
    toastUi.showUndo({
      message: `Revoked ${site}.`,
      onUndo: async () => {
        await upsertAllowlistedSites({ [site]: entry });
      },
    });
  }
};

const revokeSelected = async (): Promise<void> => {
  const keys = [...selected];
  if (keys.length === 0) return;

  const ok = await confirmUi.confirm({
    title: 'Revoke selected sites?',
    body: `Browser Bridge will no longer be allowed to take actions on ${keys.length} ${keys.length === 1 ? 'site' : 'sites'}.`,
    confirmText: 'Revoke selected',
  });
  if (!ok) return;

  const before = await getAllowlistedSites();
  const removed: Record<string, { createdAt: string; lastUsedAt: string }> = {};
  for (const k of keys) {
    const entry = before[k.toLowerCase()];
    if (entry) removed[k] = entry;
  }

  await revokeSites(keys);
  selected.clear();
  await refresh();

  if (Object.keys(removed).length > 0) {
    toastUi.showUndo({
      message: `Revoked ${Object.keys(removed).length} ${Object.keys(removed).length === 1 ? 'site' : 'sites'}.`,
      onUndo: async () => {
        await upsertAllowlistedSites(removed);
      },
    });
  }
};

const revokeAll = async (): Promise<void> => {
  if (allRows.length === 0) return;

  const ok = await confirmUi.confirm({
    title: 'Revoke all sites?',
    body: `Browser Bridge will no longer be allowed to take actions on any previously approved site (${allRows.length}).`,
    confirmText: 'Revoke all',
  });
  if (!ok) return;

  const before = await getAllowlistedSites();
  await setAllowlistedSites({});
  selected.clear();
  await refresh();

  if (Object.keys(before).length > 0) {
    toastUi.showUndo({
      message: `Revoked all sites (${Object.keys(before).length}).`,
      onUndo: async () => {
        await upsertAllowlistedSites(before);
      },
    });
  }
};

const refresh = async (): Promise<void> => {
  const allowlist = await getAllowlistedSites();
  const rows: Row[] = Object.entries(allowlist).map(([site, entry]) => ({
    site,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
  }));

  allRows = rows;
  renderCurrent();
};

const main = (): void => {
  void refresh();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chrome as any).storage?.onChanged?.addListener?.(() => {
    void refresh();
  });
};

main();
