type Decision = 'approve' | 'deny';

const PORT_NAME = 'permissions_request_prompt';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
};

const escapeHtml = (raw: string): string =>
  raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const setApproveDisabled = (disabled: boolean): void => {
  (byId('bb-approve') as HTMLButtonElement).disabled = disabled;
};

const setAllDisabled = (disabled: boolean): void => {
  (byId('bb-approve') as HTMLButtonElement).disabled = disabled;
  (byId('bb-deny') as HTMLButtonElement).disabled = disabled;
  const acknowledge = byId('bb-acknowledge') as HTMLInputElement | null;
  if (acknowledge) {
    acknowledge.disabled = disabled;
  }
};

const describeRequest = (
  kind: string,
  site: string,
  mode: string,
  source: string
): { title: string; summary: string } => {
  const sourceLabel = source
    ? `${source.toUpperCase()} requested:`
    : 'Request:';
  switch (kind) {
    case 'allow_site':
      return {
        title: 'Approve site access',
        summary: `${sourceLabel} allow Browser Bridge actions on <span class="bb-inline-code">${escapeHtml(
          site
        )}</span>.`,
      };
    case 'revoke_site':
      return {
        title: 'Approve site revoke',
        summary: `${sourceLabel} revoke Browser Bridge actions on <span class="bb-inline-code">${escapeHtml(
          site
        )}</span>.`,
      };
    case 'set_mode':
      return {
        title:
          mode === 'bypass' ? 'Approve bypass mode' : 'Approve granular mode',
        summary: `${sourceLabel} switch Browser Bridge to <span class="bb-inline-code">${escapeHtml(
          mode
        )}</span> mode.`,
      };
    default:
      return {
        title: 'Approve permissions change',
        summary: `${sourceLabel} update Browser Bridge permissions.`,
      };
  }
};

const main = (): void => {
  const qs = new URLSearchParams(window.location.search);
  const requestId = qs.get('requestId') ?? '';
  const kind = qs.get('kind') ?? '';
  const site = qs.get('site') ?? '';
  const mode = qs.get('mode') ?? '';
  const source = qs.get('source') ?? '';
  const warning = qs.get('warning') ?? '';
  const requireAcknowledge = qs.get('requireAcknowledge') === '1';

  const title = byId('bb-title');
  const summary = byId('bb-summary');
  const details = byId('bb-details');
  const warningSection = byId('bb-warning');
  const warningText = byId('bb-warning-text');
  const acknowledgeWrap = byId('bb-acknowledge-wrap');
  const acknowledge = byId('bb-acknowledge') as HTMLInputElement;

  if (!requestId || !kind) {
    title.textContent = 'Invalid request';
    summary.textContent = 'Close this window and retry.';
    details.textContent = '';
    setAllDisabled(true);
    return;
  }

  const copy = describeRequest(kind, site, mode, source);
  title.textContent = copy.title;
  summary.innerHTML = copy.summary;
  details.textContent = site || mode || '';

  if (warning) {
    warningSection.hidden = false;
    warningText.textContent = warning;
  }

  if (requireAcknowledge) {
    acknowledgeWrap.hidden = false;
    setApproveDisabled(true);
    acknowledge.addEventListener('change', () => {
      setApproveDisabled(!acknowledge.checked);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = (chrome as any).runtime.connect({ name: PORT_NAME });

  const sendDecision = (decision: Decision): void => {
    setAllDisabled(true);
    try {
      port.postMessage({
        type: 'decision',
        requestId,
        decision,
      });
    } finally {
      window.setTimeout(() => window.close(), 50);
    }
  };

  byId('bb-approve').addEventListener('click', () => sendDecision('approve'));
  byId('bb-deny').addEventListener('click', () => sendDecision('deny'));
};

main();

export {};
