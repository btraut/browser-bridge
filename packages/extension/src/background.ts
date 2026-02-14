import type {
  DebuggerCommandParams,
  DebuggerEvent,
  DebuggerRequest,
  DriveRequest,
  DriveErrorInfo,
  DriveEvent,
  DriveHelloParams,
  DriveResponse,
  DriveTabInfo,
  DriveTabListResult,
  ExtensionMessage,
  ExtensionRequest,
} from './protocol.js';
import { sanitizeDriveErrorInfo } from './error-sanitizer.js';
import { PermissionPromptController } from './permission-prompt.js';
import {
  allowSiteAlways,
  isSiteAllowed,
  readSitePermissionsMode,
  siteKeyFromUrl,
  touchSiteLastUsed,
} from './site-permissions.js';

type ContentResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: DriveErrorInfo };

type ContentRequest = {
  action: string;
  params?: Record<string, unknown>;
};

type DebuggerTarget = {
  tabId?: number;
};

type DebuggerSession = {
  attached: boolean;
  attachPromise?: Promise<void>;
  idleTimer?: number;
  lastActivityAt: string;
  initialized?: boolean;
};

type ScreenPoint = {
  x: number;
  y: number;
};

const DEFAULT_CORE_PORT = 3210;
const CORE_PORT_KEY = 'corePort';
const CORE_WS_PATH = '/drive';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEBUGGER_IDLE_TIMEOUT_KEY = 'debuggerIdleTimeoutMs';
const DEFAULT_DEBUGGER_IDLE_TIMEOUT_MS = 15000;
const DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS = 10000;

const AGENT_TAB_ID_KEY = 'agentTabId';
const AGENT_TAB_GROUP_TITLE = '🌉 Browser Bridge';

const nowIso = (): string => new Date().toISOString();

const makeEventId = (() => {
  let counter = 0;
  return () => `evt-${Date.now()}-${(counter += 1)}`;
})();

const lastActiveAtByTab = new Map<number, string>();

// When callers omit tab_id, we avoid taking over the user's active tab by
// creating (and reusing) a dedicated "agent" window/tab.
let agentTabId: number | null = null;

const ensureLastActiveAt = (tabId: number): string => {
  const existing = lastActiveAtByTab.get(tabId);
  if (existing) {
    return existing;
  }
  const timestamp = nowIso();
  lastActiveAtByTab.set(tabId, timestamp);
  return timestamp;
};

const markTabActive = (tabId: number): string => {
  const timestamp = nowIso();
  lastActiveAtByTab.set(tabId, timestamp);
  return timestamp;
};

const wrapChromeCallback = <T>(
  invoker: (callback: (value: T) => void) => void
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    invoker((value: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(value);
    });
  });

const wrapChromeVoid = (
  invoker: (callback: () => void) => void
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    invoker(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
};

const delayMs = async (ms: number): Promise<void> => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    self.setTimeout(resolve, ms);
  });
};

const parseDataUrl = (
  dataUrl: string
): { mime: string; base64: string } | null => {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mime: match[1] ?? 'application/octet-stream', base64: match[2] };
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const renderDataUrlToFormat = async (
  dataUrl: string,
  format: 'png' | 'jpeg' | 'webp',
  quality?: number
): Promise<{
  mime: string;
  data_base64: string;
  width_px: number;
  height_px: number;
}> => {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('Invalid screenshot data URL.');
  }

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context unavailable.');
    }
    ctx.drawImage(bitmap, 0, 0);

    const mime =
      format === 'jpeg'
        ? 'image/jpeg'
        : format === 'webp'
          ? 'image/webp'
          : 'image/png';
    const q =
      typeof quality === 'number' && Number.isFinite(quality)
        ? Math.max(0, Math.min(1, quality / 100))
        : undefined;
    const out =
      format === 'png'
        ? await canvas.convertToBlob({ type: mime })
        : await canvas.convertToBlob({ type: mime, quality: q });
    const base64 = arrayBufferToBase64(await out.arrayBuffer());

    return {
      mime,
      data_base64: base64,
      width_px: bitmap.width,
      height_px: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
};

const readCorePort = async (): Promise<number> => {
  return await new Promise<number>((resolve) => {
    chrome.storage.local.get(
      [CORE_PORT_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[CORE_PORT_KEY];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          resolve(raw);
          return;
        }
        if (typeof raw === 'string') {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            resolve(parsed);
            return;
          }
        }
        resolve(DEFAULT_CORE_PORT);
      }
    );
  });
};

const readDebuggerIdleTimeoutMs = async (): Promise<number> => {
  return await new Promise<number>((resolve) => {
    chrome.storage.local.get(
      [DEBUGGER_IDLE_TIMEOUT_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[DEBUGGER_IDLE_TIMEOUT_KEY];
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
        resolve(DEFAULT_DEBUGGER_IDLE_TIMEOUT_MS);
      }
    );
  });
};

const RESTRICTED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-devtools://',
  'devtools://',
  'edge://',
  'brave://',
  'view-source:',
];

const isRestrictedUrl = (url?: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const lowered = url.toLowerCase();
  if (RESTRICTED_URL_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'chromewebstore.google.com') {
      return true;
    }
    if (parsed.hostname === 'chrome.google.com') {
      return parsed.pathname.startsWith('/webstore');
    }
  } catch (error) {
    console.debug('Ignoring invalid URL in restriction check.', error);
  }
  return false;
};

const mapDebuggerErrorMessage = (
  message: string,
  fallbackCode = 'INSPECT_UNAVAILABLE'
): DriveErrorInfo => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('already attached') ||
    normalized.includes('another debugger') ||
    normalized.includes('attached to this target')
  ) {
    return {
      code: 'DEBUGGER_IN_USE',
      message:
        'Debugger already attached. Close DevTools on the target tab and retry.',
      retryable: true,
      details: {
        reason: 'debugger_in_use',
        hint: 'Close DevTools on the target tab and retry.',
        original_message: message,
      },
    };
  }
  if (
    normalized.includes('no tab') ||
    normalized.includes('no target') ||
    normalized.includes('tab id')
  ) {
    return {
      code: 'TAB_NOT_FOUND',
      message,
      retryable: false,
    };
  }
  if (
    normalized.includes('not allowed') ||
    normalized.includes('permission') ||
    normalized.includes('denied')
  ) {
    return {
      code: 'ATTACH_DENIED',
      message,
      retryable: false,
    };
  }
  if (
    normalized.includes('cannot access') ||
    normalized.includes('not supported') ||
    normalized.includes('disallowed')
  ) {
    return {
      code: 'NOT_SUPPORTED',
      message,
      retryable: false,
    };
  }
  return {
    code: fallbackCode,
    message,
    retryable: false,
  };
};

const buildTabInfo = (tab: Record<string, unknown>): DriveTabInfo | null => {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (typeof tabId !== 'number' || typeof windowId !== 'number') {
    return null;
  }
  return {
    tab_id: tabId,
    window_id: windowId,
    url: typeof tab.url === 'string' ? tab.url : undefined,
    title: typeof tab.title === 'string' ? tab.title : undefined,
    active: typeof tab.active === 'boolean' ? tab.active : undefined,
    last_active_at: ensureLastActiveAt(tabId),
  };
};

const queryTabs = async (): Promise<DriveTabInfo[]> => {
  const tabs = await wrapChromeCallback<Record<string, unknown>[]>((callback) =>
    chrome.tabs.query({}, callback)
  );
  const result: DriveTabInfo[] = [];
  for (const tab of tabs) {
    const info = buildTabInfo(tab);
    if (info) {
      result.push(info);
    }
  }
  return result;
};

const getTab = async (tabId: number): Promise<Record<string, unknown>> => {
  return await wrapChromeCallback<Record<string, unknown>>((callback) =>
    chrome.tabs.get(tabId, callback)
  );
};

const getActiveTabId = async (): Promise<number> => {
  const tabs = await wrapChromeCallback<Record<string, unknown>[]>((callback) =>
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, callback)
  );
  const first = tabs[0];
  if (first && typeof first.id === 'number') {
    return first.id;
  }
  throw new Error('No active tab found.');
};

const clearAgentTarget = (): void => {
  agentTabId = null;
  // Best-effort; the service worker may be shutting down.
  void writeAgentTabId(null);
};

const queryActiveTabIdInWindow = async (windowId: number): Promise<number> => {
  const tabs = await wrapChromeCallback<Record<string, unknown>[]>((callback) =>
    chrome.tabs.query({ active: true, windowId }, callback)
  );
  const first = tabs[0];
  if (first && typeof first.id === 'number') {
    return first.id;
  }

  const anyTabs = await wrapChromeCallback<Record<string, unknown>[]>(
    (callback) => chrome.tabs.query({ windowId }, callback)
  );
  const fallback = anyTabs[0];
  if (fallback && typeof fallback.id === 'number') {
    return fallback.id;
  }

  throw new Error('No tab found for window.');
};

const ensureAgentTabGroup = async (
  tabId: number,
  windowId: number
): Promise<void> => {
  if (typeof chrome.tabs?.group !== 'function') {
    return;
  }
  if (!chrome.tabGroups || typeof chrome.tabGroups.update !== 'function') {
    return;
  }

  try {
    const groupId = await wrapChromeCallback<number>((callback) =>
      chrome.tabs.group(
        { tabIds: tabId, createProperties: { windowId } },
        callback
      )
    );
    await wrapChromeVoid((callback) =>
      chrome.tabGroups.update(groupId, { title: AGENT_TAB_GROUP_TITLE }, () =>
        callback()
      )
    );
  } catch (error) {
    console.debug('Failed to create/update agent tab group.', error);
  }
};

const createAgentWindow = async (): Promise<number> => {
  const created = await wrapChromeCallback<Record<string, unknown>>(
    (callback) =>
      chrome.windows.create({ url: 'about:blank', focused: true }, callback)
  );
  const windowId = created.id;
  if (typeof windowId !== 'number') {
    throw new Error('Failed to create agent window.');
  }
  const tabId = await queryActiveTabIdInWindow(windowId);
  await ensureAgentTabGroup(tabId, windowId);
  return tabId;
};

const readAgentTabId = async (): Promise<number | null> => {
  return await new Promise<number | null>((resolve) => {
    chrome.storage.local.get(
      [AGENT_TAB_ID_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[AGENT_TAB_ID_KEY];
        resolve(typeof raw === 'number' && Number.isFinite(raw) ? raw : null);
      }
    );
  });
};

const writeAgentTabId = async (tabId: number | null): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    };

    if (tabId === null) {
      chrome.storage.local.remove([AGENT_TAB_ID_KEY], done);
      return;
    }

    chrome.storage.local.set({ [AGENT_TAB_ID_KEY]: tabId }, done);
  }).catch((error) => {
    console.debug('Failed to persist agentTabId.', error);
  });
};

const getOrCreateAgentTabId = async (): Promise<number> => {
  if (agentTabId !== null) {
    try {
      const tab = await getTab(agentTabId);
      const url = tab.url;
      if (typeof url === 'string' && isRestrictedUrl(url)) {
        throw new Error(`Agent tab points at restricted URL: ${url}`);
      }
      return agentTabId;
    } catch {
      clearAgentTarget();
    }
  }

  const stored = await readAgentTabId();
  if (stored !== null) {
    try {
      const tab = await getTab(stored);
      const url = tab.url;
      if (typeof url === 'string' && isRestrictedUrl(url)) {
        throw new Error(`Stored agent tab points at restricted URL: ${url}`);
      }
      agentTabId = stored;
      ensureLastActiveAt(stored);
      markTabActive(stored);
      return stored;
    } catch {
      await writeAgentTabId(null);
    }
  }

  const tabId = await createAgentWindow();
  agentTabId = tabId;
  ensureLastActiveAt(tabId);
  markTabActive(tabId);
  await writeAgentTabId(tabId);
  return tabId;
};

const getDefaultTabId = async (): Promise<number> => {
  try {
    return await getOrCreateAgentTabId();
  } catch (error) {
    console.warn(
      'Failed to create agent window/tab; falling back to active tab.',
      error
    );
    return await getActiveTabId();
  }
};

const sendToTab = async (
  tabId: number,
  action: string,
  params?: Record<string, unknown>
): Promise<ContentResult> => {
  const attemptSend = async (): Promise<ContentResult> => {
    return await new Promise<ContentResult>((resolve) => {
      const message: ContentRequest = { action, params };
      chrome.tabs.sendMessage(tabId, message, (response: ContentResult) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({
            ok: false,
            error: {
              code: 'EVALUATION_FAILED',
              message: error.message,
              retryable: false,
            },
          });
          return;
        }
        if (!response || typeof response !== 'object') {
          resolve({
            ok: false,
            error: {
              code: 'EVALUATION_FAILED',
              message: 'Empty response from content script.',
              retryable: false,
            },
          });
          return;
        }
        resolve(response);
      });
    });
  };

  // After navigation, MV3 content scripts can lag slightly behind the tab's URL
  // update. Retrying avoids flaky "Receiving end does not exist" failures.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await attemptSend();
    if (result.ok) {
      return result;
    }
    const message = result.error?.message;
    const isNoReceiver =
      typeof message === 'string' &&
      message.toLowerCase().includes('receiving end does not exist');
    if (!isNoReceiver || attempt === MAX_ATTEMPTS) {
      return result;
    }
    await delayMs(200);
  }

  // Unreachable (loop always returns), but keeps TS happy if this code moves.
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: 'Failed to send message to content script.',
      retryable: false,
    },
  };
};

const waitForDomContentLoaded = async (
  tabId: number,
  timeoutMs: number
): Promise<void> => {
  return await new Promise<void>((resolve, reject) => {
    let timeout: number | undefined;
    const cleanup = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      chrome.webNavigation.onDOMContentLoaded.removeListener(listener);
    };

    const listener = (details: { tabId: number; frameId: number }) => {
      if (details.tabId !== tabId || details.frameId !== 0) {
        return;
      }
      cleanup();
      resolve();
    };

    chrome.webNavigation.onDOMContentLoaded.addListener(listener);
    timeout = self.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for domcontentloaded.'));
    }, timeoutMs);
  });
};

const getWsUrl = async (): Promise<string> => {
  const port = await readCorePort();
  return `ws://127.0.0.1:${port}${CORE_WS_PATH}`;
};

class DriveSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 10000;
  private keepAliveTimer: number | null = null;
  private readonly keepAliveIntervalMs = 30000;
  private readonly debuggerSessions = new Map<number, DebuggerSession>();
  private debuggerIdleTimeoutMs: number | null = null;

  start(): void {
    void this.connect().catch((error) => {
      console.error('DriveSocket connect failed:', error);
    });
  }

  stop(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepAlive();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  sendTabReport(): void {
    void this.emitTabReport().catch((error) => {
      console.error('DriveSocket emitTabReport failed:', error);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectTimer = self.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        console.error('DriveSocket reconnect failed:', error);
      });
    }, delay);
    this.reconnectDelayMs = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectDelayMs * 2
    );
  }

  private async connect(): Promise<void> {
    const url = await getWsUrl();
    try {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.reconnectDelayMs = 1000;
        this.startKeepAlive();
        void this.sendHello().catch((error) => {
          console.error('DriveSocket hello failed:', error);
        });
      });

      socket.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener('close', () => {
        this.socket = null;
        this.stopKeepAlive();
        this.scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        this.socket = null;
        this.stopKeepAlive();
        this.scheduleReconnect();
      });
    } catch (error) {
      console.debug('DriveSocket connect failed, scheduling reconnect.', error);
      this.scheduleReconnect();
    }
  }

  private async sendHello(): Promise<void> {
    const manifest = chrome.runtime.getManifest();
    let tabs: DriveTabInfo[] = [];
    try {
      tabs = await queryTabs();
    } catch (error) {
      console.debug('DriveSocket sendHello failed to read tabs.', error);
      tabs = [];
    }
    const params: DriveHelloParams = {
      version: manifest.version,
      tabs,
    };
    this.sendEvent('drive.hello', params);
  }

  private async emitTabReport(): Promise<void> {
    try {
      const tabs = await queryTabs();
      this.sendEvent('drive.tab_report', { tabs });
    } catch (error) {
      console.debug('DriveSocket emitTabReport failed.', error);
    }
  }

  private sendEvent(
    action: DriveEvent['action'],
    params: DriveEvent['params']
  ): void {
    const message: DriveEvent = {
      id: makeEventId(),
      action,
      status: 'event',
      params,
    };
    this.sendMessage(message);
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = self.setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      this.sendEvent('drive.keepalive', {});
    }, this.keepAliveIntervalMs);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private sendDebuggerEvent(params: DebuggerEvent['params']): void {
    const message: DebuggerEvent = {
      id: makeEventId(),
      action: 'debugger.event',
      status: 'event',
      params,
    };
    this.sendMessage(message);
  }

  private sendMessage(message: ExtensionMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      return;
    }
    let message: ExtensionMessage | null = null;
    try {
      message = JSON.parse(raw) as ExtensionMessage;
    } catch (error) {
      console.debug('DriveSocket received invalid JSON message.', error);
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.status === 'request') {
      void this.handleRequest(message as ExtensionRequest).catch((error) => {
        console.error('DriveSocket handleRequest failed:', error);
      });
    }
  }

  private async handleRequest(message: ExtensionRequest): Promise<void> {
    let driveMessage: DriveRequest | null = null;
    let gatedSiteKey: string | null = null;
    let touchGatedSiteOnSuccess = false;
    const respondOk = (result?: unknown): void => {
      if (!driveMessage) {
        return;
      }
      if (touchGatedSiteOnSuccess && gatedSiteKey) {
        void touchSiteLastUsed(gatedSiteKey).catch((error) => {
          console.error('Failed to touch site allowlist entry:', error);
        });
      }
      const response: DriveResponse = {
        id: driveMessage.id,
        action: driveMessage.action,
        status: 'ok',
        result,
      };
      this.sendMessage(response);
    };

    const respondError = (error: DriveErrorInfo): void => {
      if (!driveMessage) {
        return;
      }
      const response: DriveResponse = {
        id: driveMessage.id,
        action: driveMessage.action,
        status: 'error',
        error: sanitizeDriveErrorInfo(error),
      };
      this.sendMessage(response);
    };

    try {
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.id !== 'string' ||
        typeof message.action !== 'string'
      ) {
        return;
      }
      if (message.action.startsWith('debugger.')) {
        await this.handleDebuggerRequest(message as DebuggerRequest);
        return;
      }

      if (!message.action.startsWith('drive.')) {
        return;
      }

      driveMessage = message as DriveRequest;

      const gatedActions = new Set<string>([
        'drive.navigate',
        'drive.go_back',
        'drive.go_forward',
        'drive.back',
        'drive.forward',
        'drive.click',
        'drive.hover',
        'drive.select',
        'drive.type',
        'drive.fill_form',
        'drive.drag',
        'drive.handle_dialog',
        'drive.key',
        'drive.key_press',
        'drive.scroll',
        'drive.screenshot',
        'drive.wait_for',
      ]);

      const gateDriveAction = async (): Promise<
        | { ok: true; siteKey: string | null; touchOnSuccess: boolean }
        | { ok: false; error: DriveErrorInfo }
      > => {
        const action = message.action;
        if (!gatedActions.has(action)) {
          return { ok: true, siteKey: null, touchOnSuccess: false };
        }

        const params = (message.params ?? {}) as Record<string, unknown>;
        let siteKey: string | null = null;

        if (action === 'drive.navigate') {
          const url = params.url;
          if (typeof url !== 'string' || url.length === 0) {
            // Let the switch handle INVALID_ARGUMENT for missing url.
            return { ok: true, siteKey: null, touchOnSuccess: false };
          }
          if (isRestrictedUrl(url)) {
            return {
              ok: false,
              error: {
                code: 'NOT_SUPPORTED',
                message: 'Navigation is not supported for this URL.',
                retryable: false,
                details: { url },
              },
            };
          }
          siteKey = siteKeyFromUrl(url);
          if (!siteKey) {
            return {
              ok: false,
              error: {
                code: 'INVALID_ARGUMENT',
                message: 'Unable to resolve site permission key for url.',
                retryable: false,
                details: { url },
              },
            };
          }
        } else {
          const tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            // Let the switch handle INVALID_ARGUMENT for tab_id shape.
            return { ok: true, siteKey: null, touchOnSuccess: false };
          }
          // IMPORTANT: Drive actions default to operating on the dedicated
          // agent tab (getDefaultTabId) when tab_id is omitted. Permission
          // gating must resolve the same tab, otherwise we might gate/prompt
          // for the wrong site.
          const resolvedTabId =
            typeof tabId === 'number' ? tabId : await getDefaultTabId();
          const tab = await getTab(resolvedTabId);
          const url = tab.url;
          if (typeof url !== 'string' || url.length === 0) {
            return {
              ok: false,
              error: {
                code: 'FAILED_PRECONDITION',
                message: 'Active tab URL is unavailable for permission gating.',
                retryable: false,
                details: { tab_id: resolvedTabId },
              },
            };
          }
          if (isRestrictedUrl(url)) {
            const message =
              action === 'drive.screenshot'
                ? 'Screenshots are not supported for this URL.'
                : 'This action is not supported for this URL.';
            return {
              ok: false,
              error: {
                code: 'NOT_SUPPORTED',
                message,
                retryable: false,
                details: { url },
              },
            };
          }
          siteKey = siteKeyFromUrl(url);
          if (!siteKey) {
            return {
              ok: false,
              error: {
                code: 'FAILED_PRECONDITION',
                message:
                  'Unable to resolve site permission key for active tab.',
                retryable: false,
                details: { url, tab_id: resolvedTabId },
              },
            };
          }
        }

        if ((await readSitePermissionsMode()) === 'bypass') {
          // Bypass mode skips the per-site allowlist and permission prompt.
          // We still enforce restricted URL checks above.
          return { ok: true, siteKey, touchOnSuccess: false };
        }

        if (await isSiteAllowed(siteKey)) {
          return { ok: true, siteKey, touchOnSuccess: true };
        }

        const decision = await permissionPrompts.requestPermission({
          siteKey,
          action,
        });

        if (decision.kind === 'timed_out') {
          return {
            ok: false,
            error: {
              code: 'PERMISSION_PROMPT_TIMEOUT',
              message: `Permission prompt timed out for ${siteKey}.`,
              retryable: true,
              details: {
                reason: 'prompt_timed_out',
                site: siteKey,
                action,
                wait_ms: decision.waitMs,
              },
            },
          };
        }

        if (decision.kind === 'deny') {
          return {
            ok: false,
            error: {
              code: 'PERMISSION_DENIED',
              message: `User denied Browser Bridge permission for ${siteKey}.`,
              retryable: false,
              details: {
                reason: 'user_denied',
                site: siteKey,
                action,
                next_step:
                  'Ask the user to approve the permission prompt (Allow/Always allow) or allow the site in the extension options page, then retry the command.',
              },
            },
          };
        }

        if (decision.kind === 'allow_always') {
          // Ensure the allowlist is persisted even if the controller didn't (or couldn't).
          await allowSiteAlways(siteKey);
          return { ok: true, siteKey, touchOnSuccess: true };
        }

        // allow_once
        return { ok: true, siteKey, touchOnSuccess: false };
      };

      const gated = await gateDriveAction();
      if (!gated.ok) {
        respondError(gated.error);
        return;
      }
      gatedSiteKey = gated.siteKey;
      touchGatedSiteOnSuccess = gated.touchOnSuccess;

      switch (message.action) {
        case 'drive.ping': {
          respondOk({ ok: true });
          return;
        }
        case 'drive.navigate': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const url = params.url;
          if (typeof url !== 'string' || url.length === 0) {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'url must be a non-empty string.',
              retryable: false,
            });
            return;
          }
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }
          const waitMode =
            params.wait === 'none' || params.wait === 'domcontentloaded'
              ? params.wait
              : 'domcontentloaded';
          await wrapChromeVoid((callback) =>
            chrome.tabs.update(tabId as number, { url }, () => callback())
          );
          markTabActive(tabId as number);
          if (waitMode === 'domcontentloaded') {
            try {
              await waitForDomContentLoaded(tabId as number, 30000);
            } catch (error) {
              respondError({
                code: 'TIMEOUT',
                message:
                  error instanceof Error ? error.message : 'Timed out waiting.',
                retryable: true,
              });
              return;
            }
          }
          respondOk({ ok: true });
          return;
        }
        case 'drive.go_back':
        case 'drive.back':
        case 'drive.go_forward':
        case 'drive.forward': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }
          const result = await sendToTab(tabId as number, message.action);
          if (!result.ok) {
            respondError(result.error);
            return;
          }
          markTabActive(tabId as number);
          try {
            await waitForDomContentLoaded(tabId as number, 30000);
          } catch (error) {
            respondError({
              code: 'TIMEOUT',
              message:
                error instanceof Error ? error.message : 'Timed out waiting.',
              retryable: true,
            });
            return;
          }
          respondOk({ ok: true });
          return;
        }
        case 'drive.tab_list': {
          const tabs = await queryTabs();
          const result: DriveTabListResult = { tabs };
          respondOk(result);
          return;
        }
        case 'drive.tab_activate': {
          const tabId = (message.params as Record<string, unknown> | undefined)
            ?.tab_id;
          if (typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number.',
              retryable: false,
            });
            return;
          }
          const tab = await getTab(tabId);
          await wrapChromeVoid((callback) =>
            chrome.tabs.update(tabId, { active: true }, () => callback())
          );
          const windowId = tab.windowId;
          if (typeof windowId === 'number') {
            await wrapChromeVoid((callback) =>
              chrome.windows.update(windowId, { focused: true }, () =>
                callback()
              )
            );
          }
          markTabActive(tabId);
          respondOk({ ok: true });
          this.sendTabReport();
          return;
        }
        case 'drive.tab_close': {
          const tabId = (message.params as Record<string, unknown> | undefined)
            ?.tab_id;
          if (typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number.',
              retryable: false,
            });
            return;
          }
          await wrapChromeVoid((callback) =>
            chrome.tabs.remove(tabId, () => callback())
          );
          if (agentTabId === tabId) {
            clearAgentTarget();
          }
          lastActiveAtByTab.delete(tabId);
          respondOk({ ok: true });
          this.sendTabReport();
          return;
        }
        case 'drive.handle_dialog': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const action = params.action;
          if (action !== 'accept' && action !== 'dismiss') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'action must be accept or dismiss.',
              retryable: false,
            });
            return;
          }
          const promptText = params.promptText;
          if (promptText !== undefined && typeof promptText !== 'string') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'promptText must be a string when provided.',
              retryable: false,
            });
            return;
          }
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }

          const error = await this.ensureDebuggerAttached(tabId as number);
          if (error) {
            respondError(error);
            return;
          }

          try {
            await this.sendDebuggerCommand(
              tabId as number,
              'Page.handleJavaScriptDialog',
              {
                accept: action === 'accept',
                ...(promptText ? { promptText } : {}),
              },
              DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
            );
            this.touchDebuggerSession(tabId as number);
            respondOk({ ok: true });
          } catch (error) {
            const info = mapDebuggerErrorMessage(
              error instanceof Error ? error.message : 'Dialog handling failed.'
            );
            respondError(info);
          }
          return;
        }
        case 'drive.click': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }

          const clickCount = params.click_count;
          const count =
            typeof clickCount === 'number' && Number.isFinite(clickCount)
              ? Math.max(1, Math.floor(clickCount))
              : 1;

          const error = await this.ensureDebuggerAttached(tabId as number);
          if (error) {
            respondError(error);
            return;
          }

          const pointResult = await this.resolveLocatorPoint(
            tabId as number,
            params.locator
          );
          if (!pointResult.ok) {
            respondError(pointResult.error);
            return;
          }
          const { x, y } = pointResult.point;

          // JS dialogs can block the tab event loop; dispatch click events on
          // the next tick so we can acknowledge the command immediately.
          self.setTimeout(() => {
            void this.dispatchCdpClick(tabId as number, x, y, count).catch(
              (error) => {
                console.debug('Deferred CDP click failed.', error);
              }
            );
          }, 0);
          respondOk({ ok: true });
          return;
        }
        case 'drive.hover': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }

          const error = await this.ensureDebuggerAttached(tabId as number);
          if (error) {
            respondError(error);
            return;
          }
          const pointResult = await this.resolveLocatorPoint(
            tabId as number,
            params.locator
          );
          if (!pointResult.ok) {
            respondError(pointResult.error);
            return;
          }
          const { x, y } = pointResult.point;

          const waitMs =
            typeof params.delay_ms === 'number' &&
            Number.isFinite(params.delay_ms)
              ? Math.min(Math.max(params.delay_ms, 0), 10000)
              : 0;
          try {
            await this.dispatchCdpMouseMove(tabId as number, x, y, 0);
            if (waitMs > 0) {
              await delayMs(waitMs);
            }
            const snapshot = await sendToTab(
              tabId as number,
              'drive.snapshot_html'
            );
            if (!snapshot.ok) {
              respondError(snapshot.error);
              return;
            }
            respondOk(snapshot.result ?? { format: 'html', snapshot: '' });
          } catch (error) {
            const info = mapDebuggerErrorMessage(
              error instanceof Error ? error.message : 'Hover dispatch failed.'
            );
            respondError(info);
          }
          return;
        }
        case 'drive.drag': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }

          const error = await this.ensureDebuggerAttached(tabId as number);
          if (error) {
            respondError(error);
            return;
          }
          const fromResult = await this.resolveLocatorPoint(
            tabId as number,
            params.from
          );
          if (!fromResult.ok) {
            respondError(fromResult.error);
            return;
          }
          const toResult = await this.resolveLocatorPoint(
            tabId as number,
            params.to
          );
          if (!toResult.ok) {
            respondError(toResult.error);
            return;
          }
          const steps =
            typeof params.steps === 'number' && Number.isFinite(params.steps)
              ? Math.max(1, Math.min(50, Math.floor(params.steps)))
              : 12;
          try {
            await this.dispatchCdpDrag(
              tabId as number,
              fromResult.point,
              toResult.point,
              steps
            );
            respondOk({ ok: true });
          } catch (error) {
            const info = mapDebuggerErrorMessage(
              error instanceof Error ? error.message : 'Drag dispatch failed.'
            );
            respondError(info);
          }
          return;
        }
        case 'drive.select':
        case 'drive.type':
        case 'drive.fill_form':
        case 'drive.key':
        case 'drive.key_press':
        case 'drive.scroll':
        case 'drive.wait_for': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }
          const result = await sendToTab(
            tabId as number,
            message.action,
            params
          );
          if (result.ok) {
            respondOk(result.result ?? { ok: true });
          } else {
            respondError(result.error);
          }
          return;
        }
        case 'drive.screenshot': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number when provided.',
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getDefaultTabId();
          }

          const mode =
            params.mode === 'full_page' ||
            params.mode === 'viewport' ||
            params.mode === 'element'
              ? params.mode
              : 'viewport';
          const format =
            params.format === 'jpeg' || params.format === 'webp'
              ? params.format
              : 'png';
          const quality =
            typeof params.quality === 'number' &&
            Number.isFinite(params.quality)
              ? Math.max(0, Math.min(100, Math.floor(params.quality)))
              : undefined;

          const tab = await getTab(tabId as number);
          const url = tab.url;
          if (typeof url === 'string' && isRestrictedUrl(url)) {
            respondError({
              code: 'NOT_SUPPORTED',
              message: 'Screenshots are not supported for this URL.',
              retryable: false,
              details: { url },
            });
            return;
          }
          const windowId = tab.windowId;
          if (typeof windowId !== 'number') {
            respondError({
              code: 'TAB_NOT_FOUND',
              message: 'window_id missing for tab.',
              retryable: false,
            });
            return;
          }

          if (typeof OffscreenCanvas === 'undefined') {
            respondError({
              code: 'NOT_SUPPORTED',
              message: 'OffscreenCanvas is unavailable in this extension host.',
              retryable: false,
            });
            return;
          }

          const captureVisible = async (): Promise<string> => {
            return await wrapChromeCallback<string>((callback) =>
              chrome.tabs.captureVisibleTab(
                windowId,
                { format: 'png' },
                callback
              )
            );
          };

          const scrollTo = async (top: number, left: number): Promise<void> => {
            const result = await sendToTab(tabId as number, 'drive.scroll', {
              top,
              left,
              behavior: 'auto',
              tab_id: tabId,
            });
            if (!result.ok) {
              throw new Error(result.error.message);
            }
          };

          const getMetaInfo = async (): Promise<{
            viewportHeight: number;
            scrollHeight: number;
            scrollY: number;
            scrollX: number;
            devicePixelRatio: number;
            fullHeightPx: number;
            positions: number[];
          }> => {
            const meta = await sendToTab(
              tabId as number,
              'drive.screenshot_meta'
            );
            if (!meta.ok) {
              throw new Error(meta.error.message);
            }
            const payload = meta.result;
            if (!payload || typeof payload !== 'object') {
              throw new Error('Invalid screenshot metadata response.');
            }

            const record = payload as Record<string, unknown>;
            const viewportHeight = record.viewportHeight;
            const scrollHeight = record.scrollHeight;
            const scrollY = record.scrollY;
            const scrollX = record.scrollX;
            const dpr = record.devicePixelRatio;

            if (
              typeof viewportHeight !== 'number' ||
              !Number.isFinite(viewportHeight) ||
              viewportHeight <= 0
            ) {
              throw new Error(
                'viewportHeight missing from screenshot metadata.'
              );
            }
            if (
              typeof scrollHeight !== 'number' ||
              !Number.isFinite(scrollHeight) ||
              scrollHeight <= 0
            ) {
              throw new Error('scrollHeight missing from screenshot metadata.');
            }

            const devicePixelRatio =
              typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0
                ? dpr
                : 1;

            const fullHeightPx = Math.round(scrollHeight * devicePixelRatio);
            const maxHeightPx = 50000;
            if (fullHeightPx > maxHeightPx) {
              throw new Error(
                `Page is too tall to capture (max ${maxHeightPx}px).`
              );
            }

            const maxScrollY = Math.max(0, scrollHeight - viewportHeight);
            const step = viewportHeight;
            const positions: number[] = [];
            for (let y = 0; y < maxScrollY; y += step) {
              positions.push(y);
            }
            positions.push(maxScrollY);

            const maxTiles = 200;
            if (positions.length > maxTiles) {
              throw new Error(
                `Page requires too many tiles to capture (${positions.length}).`
              );
            }

            return {
              viewportHeight,
              scrollHeight,
              scrollY:
                typeof scrollY === 'number' && Number.isFinite(scrollY)
                  ? scrollY
                  : 0,
              scrollX:
                typeof scrollX === 'number' && Number.isFinite(scrollX)
                  ? scrollX
                  : 0,
              devicePixelRatio,
              fullHeightPx,
              positions,
            };
          };

          const canvasToResult = async (
            canvas: OffscreenCanvas
          ): Promise<{
            mime: string;
            data_base64: string;
            width_px: number;
            height_px: number;
          }> => {
            const mime =
              format === 'jpeg'
                ? 'image/jpeg'
                : format === 'webp'
                  ? 'image/webp'
                  : 'image/png';
            const q =
              typeof quality === 'number' && Number.isFinite(quality)
                ? Math.max(0, Math.min(1, quality / 100))
                : undefined;
            const blob =
              format === 'png'
                ? await canvas.convertToBlob({ type: mime })
                : await canvas.convertToBlob({ type: mime, quality: q });
            const base64 = arrayBufferToBase64(await blob.arrayBuffer());
            return {
              mime,
              data_base64: base64,
              width_px: canvas.width,
              height_px: canvas.height,
            };
          };

          const captureFullPageCanvas = async (
            metaInfo: Awaited<ReturnType<typeof getMetaInfo>>
          ): Promise<OffscreenCanvas> => {
            try {
              await scrollTo(0, 0);
              await delayMs(100);

              const firstDataUrl = await captureVisible();
              const firstBlob = await (await fetch(firstDataUrl)).blob();
              const firstBitmap = await createImageBitmap(firstBlob);

              const canvas = new OffscreenCanvas(
                firstBitmap.width,
                metaInfo.fullHeightPx
              );
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                firstBitmap.close();
                throw new Error('Canvas context unavailable.');
              }

              const drawTile = (bitmap: ImageBitmap, yCss: number): void => {
                const destY = Math.round(yCss * metaInfo.devicePixelRatio);
                const remaining = metaInfo.fullHeightPx - destY;
                if (remaining <= 0) {
                  return;
                }
                const drawHeight = Math.min(bitmap.height, remaining);
                ctx.drawImage(
                  bitmap,
                  0,
                  0,
                  bitmap.width,
                  drawHeight,
                  0,
                  destY,
                  bitmap.width,
                  drawHeight
                );
              };

              drawTile(firstBitmap, 0);
              firstBitmap.close();

              for (const y of metaInfo.positions.slice(1)) {
                await scrollTo(y, 0);
                await delayMs(100);
                const dataUrl = await captureVisible();
                const blob = await (await fetch(dataUrl)).blob();
                const bitmap = await createImageBitmap(blob);
                drawTile(bitmap, y);
                bitmap.close();
              }

              return canvas;
            } finally {
              try {
                await scrollTo(metaInfo.scrollY, metaInfo.scrollX);
              } catch {
                // Ignore restoration errors.
              }
            }
          };

          if (mode === 'viewport') {
            try {
              const dataUrl = await captureVisible();
              const rendered = await renderDataUrlToFormat(
                dataUrl,
                format,
                quality
              );
              respondOk(rendered);
            } catch (error) {
              respondError({
                code: 'ARTIFACT_IO_ERROR',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Failed to capture screenshot.',
                retryable: false,
              });
            }
            return;
          }

          if (mode === 'element') {
            const selector = params.selector;
            if (typeof selector !== 'string' || selector.trim().length === 0) {
              respondError({
                code: 'INVALID_ARGUMENT',
                message: 'selector must be a non-empty string.',
                retryable: false,
              });
              return;
            }

            let metaInfo: Awaited<ReturnType<typeof getMetaInfo>>;
            try {
              metaInfo = await getMetaInfo();
            } catch (error) {
              respondError({
                code: 'EVALUATION_FAILED',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Failed to read screenshot metadata.',
                retryable: false,
              });
              return;
            }

            const element = await sendToTab(
              tabId as number,
              'drive.screenshot_element',
              { selector }
            );
            if (!element.ok) {
              respondError(element.error);
              return;
            }

            const payload = element.result;
            if (!payload || typeof payload !== 'object') {
              respondError({
                code: 'EVALUATION_FAILED',
                message: 'Invalid element metadata response.',
                retryable: false,
              });
              return;
            }

            const record = payload as Record<string, unknown>;
            const viewportLeft = record.viewportLeft;
            const viewportTop = record.viewportTop;
            const viewportWidth = record.viewportWidth;
            const viewportHeight = record.viewportHeight;
            const width = record.width;
            const height = record.height;
            const pageX = record.pageX;
            const pageY = record.pageY;
            const dpr = record.devicePixelRatio;
            const devicePixelRatio =
              typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0
                ? dpr
                : metaInfo.devicePixelRatio;

            if (
              typeof viewportLeft !== 'number' ||
              typeof viewportTop !== 'number' ||
              typeof viewportWidth !== 'number' ||
              typeof viewportHeight !== 'number' ||
              typeof width !== 'number' ||
              typeof height !== 'number' ||
              typeof pageX !== 'number' ||
              typeof pageY !== 'number' ||
              !Number.isFinite(viewportLeft) ||
              !Number.isFinite(viewportTop) ||
              !Number.isFinite(viewportWidth) ||
              !Number.isFinite(viewportHeight) ||
              !Number.isFinite(width) ||
              !Number.isFinite(height) ||
              !Number.isFinite(pageX) ||
              !Number.isFinite(pageY)
            ) {
              respondError({
                code: 'EVALUATION_FAILED',
                message: 'Invalid element bounding box metadata.',
                retryable: false,
              });
              return;
            }

            const fitsInViewport =
              viewportLeft >= 0 &&
              viewportTop >= 0 &&
              viewportLeft + width <= viewportWidth &&
              viewportTop + height <= viewportHeight;

            const cropW = Math.max(1, Math.round(width * devicePixelRatio));
            const cropH = Math.max(1, Math.round(height * devicePixelRatio));

            try {
              if (fitsInViewport) {
                const dataUrl = await captureVisible();
                const blob = await (await fetch(dataUrl)).blob();
                const bitmap = await createImageBitmap(blob);
                try {
                  const cropX = Math.max(
                    0,
                    Math.round(viewportLeft * devicePixelRatio)
                  );
                  const cropY = Math.max(
                    0,
                    Math.round(viewportTop * devicePixelRatio)
                  );
                  const srcW = Math.min(cropW, bitmap.width - cropX);
                  const srcH = Math.min(cropH, bitmap.height - cropY);
                  if (srcW <= 0 || srcH <= 0) {
                    throw new Error('Element is outside screenshot bounds.');
                  }
                  const cropCanvas = new OffscreenCanvas(srcW, srcH);
                  const ctx = cropCanvas.getContext('2d');
                  if (!ctx) {
                    throw new Error('Canvas context unavailable.');
                  }
                  ctx.drawImage(
                    bitmap,
                    cropX,
                    cropY,
                    srcW,
                    srcH,
                    0,
                    0,
                    srcW,
                    srcH
                  );
                  respondOk(await canvasToResult(cropCanvas));
                } finally {
                  bitmap.close();
                }
                return;
              }

              const fullCanvas = await captureFullPageCanvas(metaInfo);
              const cropX = Math.max(0, Math.round(pageX * devicePixelRatio));
              const cropY = Math.max(0, Math.round(pageY * devicePixelRatio));
              const srcW = Math.min(cropW, fullCanvas.width - cropX);
              const srcH = Math.min(cropH, fullCanvas.height - cropY);
              if (srcW <= 0 || srcH <= 0) {
                throw new Error('Element is outside screenshot bounds.');
              }
              const cropCanvas = new OffscreenCanvas(srcW, srcH);
              const ctx = cropCanvas.getContext('2d');
              if (!ctx) {
                throw new Error('Canvas context unavailable.');
              }
              ctx.drawImage(
                fullCanvas,
                cropX,
                cropY,
                srcW,
                srcH,
                0,
                0,
                srcW,
                srcH
              );
              respondOk(await canvasToResult(cropCanvas));
            } catch (error) {
              respondError({
                code: 'ARTIFACT_IO_ERROR',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Failed to capture element screenshot.',
                retryable: false,
              });
            } finally {
              try {
                await scrollTo(metaInfo.scrollY, metaInfo.scrollX);
              } catch {
                // Ignore.
              }
            }
            return;
          }

          try {
            const metaInfo = await getMetaInfo();
            const canvas = await captureFullPageCanvas(metaInfo);
            respondOk(await canvasToResult(canvas));
          } catch (error) {
            respondError({
              code: 'ARTIFACT_IO_ERROR',
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to capture full page screenshot.',
              retryable: false,
            });
          }
          return;
        }
        default:
          respondError({
            code: 'NOT_IMPLEMENTED',
            message: `${message.action} not implemented in extension yet.`,
            retryable: false,
          });
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Unknown error';
      respondError({
        code: 'EVALUATION_FAILED',
        message: messageText,
        retryable: false,
      });
    }
  }

  private async dispatchCdpClick(
    tabId: number,
    x: number,
    y: number,
    clickCount: number
  ): Promise<void> {
    await this.dispatchCdpMouseMove(tabId, x, y, 0);

    for (let i = 0; i < clickCount; i += 1) {
      const normalizedClickCount = i + 1;
      await this.sendDebuggerCommand(
        tabId,
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          clickCount: normalizedClickCount,
        },
        DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
      );
      await this.sendDebuggerCommand(
        tabId,
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x,
          y,
          button: 'left',
          clickCount: normalizedClickCount,
        },
        DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
      );
    }
    this.touchDebuggerSession(tabId);
  }

  private async dispatchCdpMouseMove(
    tabId: number,
    x: number,
    y: number,
    buttons: number
  ): Promise<void> {
    await this.sendDebuggerCommand(
      tabId,
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x,
        y,
        button: 'none',
        buttons,
      },
      DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
    );
  }

  private async dispatchCdpDrag(
    tabId: number,
    from: ScreenPoint,
    to: ScreenPoint,
    steps: number
  ): Promise<void> {
    await this.dispatchCdpMouseMove(tabId, from.x, from.y, 0);
    await this.sendDebuggerCommand(
      tabId,
      'Input.dispatchMouseEvent',
      {
        type: 'mousePressed',
        x: from.x,
        y: from.y,
        button: 'left',
        clickCount: 1,
      },
      DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
    );

    for (let i = 1; i <= steps; i += 1) {
      const progress = i / steps;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      await this.dispatchCdpMouseMove(tabId, x, y, 1);
      await delayMs(10);
    }

    await this.sendDebuggerCommand(
      tabId,
      'Input.dispatchMouseEvent',
      {
        type: 'mouseReleased',
        x: to.x,
        y: to.y,
        button: 'left',
        clickCount: 1,
      },
      DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
    );
    this.touchDebuggerSession(tabId);
  }

  private async resolveLocatorPoint(
    tabId: number,
    locator: unknown
  ): Promise<
    { ok: true; point: ScreenPoint } | { ok: false; error: DriveErrorInfo }
  > {
    const point = await sendToTab(tabId, 'drive.locator_point', {
      locator,
    });
    if (!point.ok) {
      return point;
    }
    const payload = point.result;
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        error: {
          code: 'EVALUATION_FAILED',
          message: 'Invalid locator point payload.',
          retryable: false,
        },
      };
    }
    const record = payload as Record<string, unknown>;
    const x = record.x;
    const y = record.y;
    if (
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      typeof y !== 'number' ||
      !Number.isFinite(y)
    ) {
      return {
        ok: false,
        error: {
          code: 'EVALUATION_FAILED',
          message: 'Invalid locator point coordinates.',
          retryable: false,
        },
      };
    }
    return { ok: true, point: { x, y } };
  }

  private async handleDebuggerRequest(message: DebuggerRequest): Promise<void> {
    const respondAck = (result?: unknown): void => {
      this.sendMessage({
        id: message.id,
        action: message.action,
        status: 'ack',
        result,
      });
    };

    const respondError = (error: DriveErrorInfo): void => {
      this.sendMessage({
        id: message.id,
        action: message.action,
        status: 'error',
        error: sanitizeDriveErrorInfo(error),
      });
    };

    try {
      switch (message.action) {
        case 'debugger.attach': {
          const params = (message.params ?? {}) as { tab_id?: unknown };
          const tabId = params.tab_id;
          if (typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number.',
              retryable: false,
            });
            return;
          }

          const error = await this.ensureDebuggerAttached(tabId);
          if (error) {
            respondError(error);
            return;
          }
          respondAck({ ok: true });
          return;
        }
        case 'debugger.detach': {
          const params = (message.params ?? {}) as { tab_id?: unknown };
          const tabId = params.tab_id;
          if (typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number.',
              retryable: false,
            });
            return;
          }
          const error = await this.detachDebugger(tabId);
          if (error) {
            respondError(error);
            return;
          }
          respondAck({ ok: true });
          return;
        }
        case 'debugger.command': {
          const params = (message.params ?? {}) as DebuggerCommandParams;
          const tabId = params.tab_id;
          if (typeof tabId !== 'number') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'tab_id must be a number.',
              retryable: false,
            });
            return;
          }
          if (typeof params.method !== 'string' || params.method.length === 0) {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'method must be a non-empty string.',
              retryable: false,
            });
            return;
          }

          const session = this.debuggerSessions.get(tabId);
          if (session?.attachPromise) {
            try {
              await session.attachPromise;
            } catch (error) {
              const info = mapDebuggerErrorMessage(
                error instanceof Error
                  ? error.message
                  : 'Debugger attach failed.'
              );
              this.clearDebuggerSession(tabId);
              respondError(info);
              return;
            }
          }

          const attachedSession = this.debuggerSessions.get(tabId);
          if (!attachedSession?.attached) {
            respondError({
              code: 'FAILED_PRECONDITION',
              message: 'Debugger is not attached to the requested tab.',
              retryable: false,
            });
            return;
          }

          try {
            const result = await this.sendDebuggerCommand(
              tabId,
              params.method,
              params.params,
              DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
            );
            this.touchDebuggerSession(tabId);
            respondAck(result);
          } catch (error) {
            if (error instanceof DebuggerTimeoutError) {
              respondError({
                code: 'TIMEOUT',
                message: error.message,
                retryable: true,
              });
              return;
            }
            const info = mapDebuggerErrorMessage(
              error instanceof Error
                ? error.message
                : 'Debugger command failed.'
            );
            respondError(info);
          }
          return;
        }
        default:
          respondError({
            code: 'NOT_IMPLEMENTED',
            message: `${message.action} not implemented in extension yet.`,
            retryable: false,
          });
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Unexpected debugger error.';
      respondError({
        code: 'INSPECT_UNAVAILABLE',
        message: messageText,
        retryable: false,
      });
    }
  }

  async handleDebuggerEvent(
    source: DebuggerTarget,
    method: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') {
      return;
    }
    this.touchDebuggerSession(tabId);
    this.sendDebuggerEvent({
      tab_id: tabId,
      method,
      params,
      timestamp: nowIso(),
    });
  }

  async handleDebuggerDetach(
    source: DebuggerTarget,
    reason?: string
  ): Promise<void> {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') {
      return;
    }
    this.clearDebuggerSession(tabId);
    this.sendDebuggerEvent({
      tab_id: tabId,
      method: 'Debugger.detached',
      params: { reason: reason ?? 'unknown' },
      timestamp: nowIso(),
    });
  }

  private async ensureDebuggerAttached(
    tabId: number
  ): Promise<DriveErrorInfo | null> {
    const existing = this.debuggerSessions.get(tabId);
    if (existing?.attached) {
      this.touchDebuggerSession(tabId);
      return null;
    }

    if (existing?.attachPromise) {
      try {
        await existing.attachPromise;
      } catch (error) {
        const info = mapDebuggerErrorMessage(
          error instanceof Error ? error.message : 'Debugger attach failed.'
        );
        this.clearDebuggerSession(tabId);
        return info;
      }
      if (existing.attached) {
        this.touchDebuggerSession(tabId);
        return null;
      }
    }

    const preflightError = await this.checkDebuggerTarget(tabId);
    if (preflightError) {
      return preflightError;
    }

    const session: DebuggerSession = {
      attached: false,
      lastActivityAt: nowIso(),
    };
    this.debuggerSessions.set(tabId, session);

    session.attachPromise = wrapChromeVoid((callback) =>
      chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () =>
        callback()
      )
    );

    try {
      await session.attachPromise;
      session.attached = true;
      session.attachPromise = undefined;
      const initError = await this.initializeDebuggerDomains(tabId);
      if (initError) {
        await this.detachDebugger(tabId);
        return initError;
      }
      session.initialized = true;
      this.touchDebuggerSession(tabId);
      return null;
    } catch (error) {
      const info = mapDebuggerErrorMessage(
        error instanceof Error ? error.message : 'Debugger attach failed.'
      );
      this.clearDebuggerSession(tabId);
      return info;
    }
  }

  private async initializeDebuggerDomains(
    tabId: number
  ): Promise<DriveErrorInfo | null> {
    // Some CDP features (notably JS dialog handling + console/network events)
    // require domains to be enabled first. This must happen before a dialog
    // opens, otherwise Page.handleJavaScriptDialog can return "No dialog is showing".
    const methods: Array<[string, Record<string, unknown> | undefined]> = [
      ['Page.enable', undefined],
      ['Runtime.enable', undefined],
      ['Log.enable', undefined],
      ['Network.enable', undefined],
    ];

    try {
      for (const [method, params] of methods) {
        await this.sendDebuggerCommand(
          tabId,
          method,
          params,
          DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
        );
      }
      return null;
    } catch (error) {
      return mapDebuggerErrorMessage(
        error instanceof Error
          ? error.message
          : 'Debugger initialization failed.'
      );
    }
  }

  private async checkDebuggerTarget(
    tabId: number
  ): Promise<DriveErrorInfo | null> {
    try {
      const tab = await getTab(tabId);
      const url = typeof tab.url === 'string' ? tab.url : undefined;
      if (isRestrictedUrl(url)) {
        return {
          code: 'NOT_SUPPORTED',
          message: 'Debugger cannot attach to restricted pages.',
          retryable: false,
          details: { url },
        };
      }
    } catch (error) {
      return mapDebuggerErrorMessage(
        error instanceof Error ? error.message : 'Failed to locate tab.',
        'TAB_NOT_FOUND'
      );
    }
    return null;
  }

  private async detachDebugger(tabId: number): Promise<DriveErrorInfo | null> {
    const session = this.debuggerSessions.get(tabId);
    if (!session) {
      return null;
    }
    if (session.attachPromise) {
      try {
        await session.attachPromise;
      } catch (error) {
        console.debug('Debugger attach promise failed before detach.', error);
        this.clearDebuggerSession(tabId);
        return null;
      }
    }
    if (!session.attached) {
      this.clearDebuggerSession(tabId);
      return null;
    }
    try {
      await wrapChromeVoid((callback) =>
        chrome.debugger.detach({ tabId }, () => callback())
      );
    } catch (error) {
      return mapDebuggerErrorMessage(
        error instanceof Error ? error.message : 'Debugger detach failed.'
      );
    } finally {
      this.clearDebuggerSession(tabId);
    }
    return null;
  }

  private async sendDebuggerCommand(
    tabId: number,
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number
  ): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      let finished = false;
      const timeout = self.setTimeout(() => {
        finished = true;
        reject(new DebuggerTimeoutError(timeoutMs));
      }, timeoutMs);

      chrome.debugger.sendCommand(
        { tabId },
        method,
        params ?? {},
        (result: unknown) => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timeout);
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result);
        }
      );
    });
  }

  private touchDebuggerSession(tabId: number): void {
    const session = this.debuggerSessions.get(tabId);
    if (!session) {
      return;
    }
    session.lastActivityAt = nowIso();
    void this.refreshDebuggerIdleTimer(tabId).catch((error) => {
      console.error('DriveSocket refreshDebuggerIdleTimer failed:', error);
    });
  }

  private async refreshDebuggerIdleTimer(tabId: number): Promise<void> {
    const session = this.debuggerSessions.get(tabId);
    if (!session) {
      return;
    }
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    const timeoutMs = await this.getDebuggerIdleTimeoutMs();
    session.idleTimer = self.setTimeout(() => {
      void this.detachDebugger(tabId).catch((error) => {
        console.error('DriveSocket detachDebugger failed:', error);
      });
    }, timeoutMs);
  }

  private clearDebuggerSession(tabId: number): void {
    const session = this.debuggerSessions.get(tabId);
    if (!session) {
      return;
    }
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    this.debuggerSessions.delete(tabId);
  }

  private async getDebuggerIdleTimeoutMs(): Promise<number> {
    if (this.debuggerIdleTimeoutMs !== null) {
      return this.debuggerIdleTimeoutMs;
    }
    const timeout = await readDebuggerIdleTimeoutMs();
    this.debuggerIdleTimeoutMs = timeout;
    return timeout;
  }
}

class DebuggerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Debugger command timed out after ${timeoutMs}ms.`);
    this.name = 'DebuggerTimeoutError';
  }
}

const socket = new DriveSocket();
const permissionPrompts = new PermissionPromptController();

chrome.runtime.onConnect.addListener((port: unknown) => {
  permissionPrompts.handleConnect(port as Record<string, unknown>);
});

chrome.windows.onRemoved.addListener((windowId: number) => {
  permissionPrompts.handleWindowRemoved(windowId);
});

chrome.tabs.onActivated.addListener((activeInfo: { tabId: number }) => {
  markTabActive(activeInfo.tabId);
  socket.sendTabReport();
});

chrome.tabs.onCreated.addListener((tab: Record<string, unknown>) => {
  if (typeof tab.id === 'number') {
    ensureLastActiveAt(tab.id);
  }
  socket.sendTabReport();
});

chrome.tabs.onUpdated.addListener(
  (
    tabId: number,
    changeInfo: Record<string, unknown>,
    tab: Record<string, unknown>
  ) => {
    const shouldReport =
      Boolean(changeInfo.url) ||
      Boolean(changeInfo.title) ||
      changeInfo.status === 'complete';
    if (!shouldReport) {
      return;
    }
    if (tab && tab.active) {
      markTabActive(tabId);
    }
    socket.sendTabReport();
  }
);

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (agentTabId === tabId) {
    clearAgentTarget();
  }
  lastActiveAtByTab.delete(tabId);
  socket.sendTabReport();
});

chrome.debugger.onEvent.addListener(
  (source: DebuggerTarget, method: string, params: Record<string, unknown>) => {
    void socket.handleDebuggerEvent(source, method, params).catch((error) => {
      console.error('DriveSocket handleDebuggerEvent failed:', error);
    });
  }
);

chrome.debugger.onDetach.addListener(
  (source: DebuggerTarget, reason?: string) => {
    void socket.handleDebuggerDetach(source, reason).catch((error) => {
      console.error('DriveSocket handleDebuggerDetach failed:', error);
    });
  }
);

socket.start();
