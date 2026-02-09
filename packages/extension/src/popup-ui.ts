const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
};

const openOptionsPopupWindow = async (): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeAny = chrome as any;
  const url = chromeAny.runtime.getURL('options.html');
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
};

const openGithub = async (): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeAny = chrome as any;
  await new Promise<void>((resolve) => {
    chromeAny.tabs.create(
      { url: 'https://github.com/btraut/browser-bridge' },
      () => resolve()
    );
  });
};

const main = (): void => {
  byId('bb-settings').addEventListener('click', () => {
    void openOptionsPopupWindow().finally(() => window.close());
  });
  byId('bb-about').addEventListener('click', () => {
    void openGithub().finally(() => window.close());
  });
};

main();

// Make this file a module (avoid global name collisions across UI entrypoints).
export {};
