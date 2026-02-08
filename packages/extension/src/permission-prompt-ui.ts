type Decision = 'allow_once' | 'allow_always' | 'deny';

const PORT_NAME = 'permission_prompt';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
};

const setDisabled = (disabled: boolean): void => {
  for (const id of ['bb-allow-once', 'bb-allow-always', 'bb-deny']) {
    (byId(id) as HTMLButtonElement).disabled = disabled;
  }
};

const main = (): void => {
  const qs = new URLSearchParams(window.location.search);
  const requestId = qs.get('requestId') ?? '';
  const site = qs.get('site') ?? '';
  const action = qs.get('action') ?? '';

  const summary = byId('bb-summary');
  const siteEl = byId('bb-site');

  if (!requestId || !site) {
    summary.textContent = 'Invalid prompt state. Close this window and retry.';
    siteEl.textContent = '';
    setDisabled(true);
    return;
  }

  summary.innerHTML = action
    ? `Browser Bridge wants to run <span class="bb-inline-code">${escapeHtml(
        action
      )}</span> on:`
    : 'Browser Bridge wants to act on:';
  siteEl.textContent = site;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = (chrome as any).runtime.connect({ name: PORT_NAME });

  const sendDecision = (decision: Decision): void => {
    setDisabled(true);
    try {
      port.postMessage({
        type: 'decision',
        requestId,
        decision,
      });
    } finally {
      // Allow the postMessage to flush, but don't leave the window hanging.
      window.setTimeout(() => window.close(), 50);
    }
  };

  byId('bb-allow-once').addEventListener('click', () =>
    sendDecision('allow_once')
  );
  byId('bb-allow-always').addEventListener('click', () =>
    sendDecision('allow_always')
  );
  byId('bb-deny').addEventListener('click', () => sendDecision('deny'));
};

const escapeHtml = (raw: string): string => {
  // Keep it tiny; this is only used for displaying the action string.
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

main();
