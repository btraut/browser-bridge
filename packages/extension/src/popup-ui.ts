type DriveConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'backoff';

type DriveConnectionStatus = {
  state: DriveConnectionState;
  endpoint?: {
    host: string;
    port: number;
    portSource: 'default' | 'storage';
  };
  ws_url?: string;
  reconnect_delay_ms?: number;
  retry_at?: string;
  last_connected_at?: string;
  last_disconnected_at?: string;
  last_error_at?: string;
  last_error_message?: string;
  consecutive_failures: number;
};

type DriveConnectionStatusResponse = {
  ok: boolean;
  result?: DriveConnectionStatus;
};

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el as T;
};

const formatTime = (iso?: string): string => {
  if (!iso) {
    return 'Never';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString();
};

const setText = (id: string, value: string): void => {
  byId<HTMLElement>(id).textContent = value;
};

const setStateBadge = (state: DriveConnectionState): void => {
  const badge = byId<HTMLElement>('bb-conn-state');
  badge.textContent = state;
  badge.setAttribute('data-state', state);
};

const getConnectionStatus = async (): Promise<DriveConnectionStatus> => {
  const response = await new Promise<DriveConnectionStatusResponse>(
    (resolve) => {
      chrome.runtime.sendMessage(
        { action: 'drive.connection_status' },
        (message: DriveConnectionStatusResponse) => {
          resolve(message);
        }
      );
    }
  );

  if (!response?.ok || !response.result) {
    throw new Error('Connection status is unavailable.');
  }

  return response.result;
};

const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
};

const renderStatus = (status: DriveConnectionStatus): void => {
  setStateBadge(status.state);
  setText(
    'bb-conn-endpoint',
    status.ws_url ??
      (status.endpoint
        ? `ws://${status.endpoint.host}:${status.endpoint.port}/drive`
        : 'Unknown')
  );

  const source = status.endpoint?.portSource ?? 'unknown';
  setText('bb-conn-source', source);

  const lastConnected = formatTime(status.last_connected_at);
  setText('bb-conn-last-ok', lastConnected);

  const lastFailure = status.last_error_message
    ? `${status.last_error_message} (${formatTime(status.last_error_at)})`
    : 'None';
  setText('bb-conn-last-fail', lastFailure);

  const nextRetry = status.retry_at ? formatTime(status.retry_at) : 'n/a';
  setText('bb-conn-next-retry', nextRetry);
};

const openOptionsPopupWindow = async (): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeAny = chrome as any;
  const url = chromeAny.runtime.getURL('options.html');

  if (chromeAny.windows?.create) {
    await new Promise<void>((resolve) => {
      chromeAny.windows.create(
        {
          type: 'popup',
          url,
          focused: true,
          width: 900,
          height: 720,
        },
        () => resolve()
      );
    });
    return;
  }

  if (chromeAny.runtime?.openOptionsPage) {
    await chromeAny.runtime.openOptionsPage();
    return;
  }
  if (chromeAny.tabs?.create) {
    await new Promise<void>((resolve) => {
      chromeAny.tabs.create({ url }, () => resolve());
    });
    return;
  }

  window.open(url, '_blank', 'noopener');
};

const openGithub = async (): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeAny = chrome as any;
  const url = 'https://github.com/btraut/browser-bridge';
  if (chromeAny.tabs?.create) {
    await new Promise<void>((resolve) => {
      chromeAny.tabs.create({ url }, () => resolve());
    });
    return;
  }
  window.open(url, '_blank', 'noopener');
};

const main = (): void => {
  const copyButton = byId<HTMLButtonElement>('bb-copy-diagnostics');
  let latestStatus: DriveConnectionStatus | null = null;

  const refreshStatus = async (): Promise<void> => {
    try {
      const status = await getConnectionStatus();
      latestStatus = status;
      renderStatus(status);
      setText('bb-conn-error', '');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to read connection status.';
      setStateBadge('disconnected');
      setText('bb-conn-error', message);
    }
  };

  const interval = window.setInterval(() => {
    void refreshStatus();
  }, 1500);

  window.addEventListener('unload', () => {
    clearInterval(interval);
  });

  copyButton.addEventListener('click', () => {
    void (async () => {
      if (!latestStatus) {
        return;
      }
      const payload = {
        generated_at: new Date().toISOString(),
        extension_version: chrome.runtime.getManifest().version,
        connection: latestStatus,
        user_agent: navigator.userAgent,
      };
      try {
        await copyToClipboard(JSON.stringify(payload, null, 2));
        setText('bb-copy-status', 'Copied diagnostics.');
      } catch {
        setText('bb-copy-status', 'Copy failed.');
      }
    })();
  });

  byId<HTMLAnchorElement>('bb-settings').addEventListener('click', (e) => {
    e.preventDefault();
    void openOptionsPopupWindow().finally(() => window.close());
  });

  byId<HTMLAnchorElement>('bb-about').addEventListener('click', (e) => {
    e.preventDefault();
    void openGithub().finally(() => window.close());
  });

  void refreshStatus();
};

main();

export {};
