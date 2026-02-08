import { getAllowlistedSites, revokeSite } from './site-permissions.js';

type Row = {
  site: string;
  createdAt: string;
  lastUsedAt: string;
};

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
};

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return iso;
  }
  try {
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

const render = (rows: Row[]): void => {
  const container = byId('bb-sites');
  container.innerHTML = '';

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bb-site';
    empty.textContent = 'No approved sites yet.';
    container.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '10px';

    const site = document.createElement('div');
    site.className = 'bb-site';
    site.textContent = row.site;

    const meta = document.createElement('div');
    meta.className = 'bb-footnote';
    meta.textContent = `Last used: ${formatTime(row.lastUsedAt)}`;

    const revoke = document.createElement('button');
    revoke.className = 'bb-button bb-button-secondary';
    revoke.type = 'button';
    revoke.textContent = 'Revoke';
    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      try {
        await revokeSite(row.site);
      } finally {
        await refresh();
      }
    });

    wrapper.appendChild(site);
    wrapper.appendChild(meta);
    wrapper.appendChild(revoke);
    container.appendChild(wrapper);
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

const main = (): void => {
  void refresh();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chrome as any).storage?.onChanged?.addListener?.(() => {
    void refresh();
  });
};

main();
