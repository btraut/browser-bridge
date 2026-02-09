const byId = (id: string): HTMLAnchorElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  if (!(el instanceof HTMLAnchorElement)) {
    throw new Error(`Expected <a> element: ${id}`);
  }
  return el;
};

const openOptionsPopupWindow = async (): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeAny = chrome as any;
  const url = chromeAny.runtime.getURL('options.html');

  // Prefer a dedicated popup window so the options UI isn't crushed inside the toolbar popup.
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

  // Fallbacks for environments where `chrome.windows` isn't available.
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
  byId('bb-settings').addEventListener('click', (e) => {
    e.preventDefault();
    void openOptionsPopupWindow().finally(() => window.close());
  });
  byId('bb-about').addEventListener('click', (e) => {
    e.preventDefault();
    void openGithub().finally(() => window.close());
  });
};

main();

// Make this file a module (avoid global name collisions across UI entrypoints).
export {};
