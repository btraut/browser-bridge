type DriveConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'backoff';

type DriveConnectionStatus = {
  state: DriveConnectionState;
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

const setConnectedIndicator = (state: DriveConnectionState): void => {
  const connected = state === 'connected';
  const indicator = byId<HTMLElement>('bb-conn-indicator');
  indicator.setAttribute('data-connected', connected ? 'true' : 'false');
  indicator.setAttribute(
    'aria-label',
    connected ? 'Connected' : 'Disconnected'
  );
  indicator.setAttribute('title', connected ? 'Connected' : state);
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

const renderStatus = (status: DriveConnectionStatus): void => {
  setConnectedIndicator(status.state);
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
  const refreshStatus = async (): Promise<void> => {
    try {
      const status = await getConnectionStatus();
      renderStatus(status);
    } catch {
      renderStatus({ state: 'disconnected' });
    }
  };

  const interval = window.setInterval(() => {
    void refreshStatus();
  }, 1500);

  window.addEventListener('unload', () => {
    clearInterval(interval);
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
