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
import { DRIVE_WS_PROTOCOL_VERSION } from '@btraut/browser-bridge-shared/dist/contract-version';
import { sanitizeDriveErrorInfo } from './error-sanitizer.js';
import { PermissionPromptController } from './permission-prompt.js';
import {
  getTabChannelRetryDelayMs,
  isLikelyNavigationCommitted,
  isTransientTabChannelError,
} from './drive-reliability.js';
import {
  DEBUGGER_CAPABILITY_ENABLED_KEY,
  allowSiteAlways,
  isSiteAllowed,
  readDebuggerCapabilityEnabled,
  readSitePermissionsMode,
  siteKeyFromUrl,
  touchSiteLastUsed,
} from './site-permissions.js';
import { ConnectionStateTracker } from './connection-state.js';
import {
  isCaptureVisibleTabRateLimitedError,
  mapScreenshotCaptureError,
} from './screenshot-errors.js';

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

type CoreEndpointConfig = {
  host: string;
  port: number;
  portSource: 'default' | 'storage';
};

type StorageChange = {
  newValue?: unknown;
  oldValue?: unknown;
};

const DEFAULT_CORE_PORT = 3210;
const CORE_PORT_KEY = 'corePort';
const CORE_WS_PATH = '/drive';
const CORE_HEALTH_PATH = '/health';
const CORE_HEALTH_TIMEOUT_MS = 1200;

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEBUGGER_IDLE_TIMEOUT_KEY = 'debuggerIdleTimeoutMs';
const DEFAULT_DEBUGGER_IDLE_TIMEOUT_MS = 15000;
const DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS = 10000;
const DEFAULT_SEND_TO_TAB_TIMEOUT_MS = 10000;
const HISTORY_DISPATCH_TIMEOUT_MS = 2000;
const HISTORY_NAVIGATION_SIGNAL_TIMEOUT_MS = 8000;
const HISTORY_POST_NAV_DOM_GRACE_TIMEOUT_MS = 2000;

const AGENT_TAB_ID_KEY = 'agentTabId';
const AGENT_TAB_GROUP_TITLE = 'Browser Bridge';
const AGENT_TAB_BOOTSTRAP_PATH = 'agent-tab.html';
const AGENT_TAB_FAVICON_ASSET_PATH = 'assets/icons/icon-32.png';
const AGENT_TAB_BRANDING_ACTION = 'drive.agent_tab_branding';
const AGENT_TAB_GROUP_RETRY_DELAYS_MS = [0, 120, 300] as const;
const AGENT_TAB_BRANDING_TIMEOUT_MS = 1500;

const BASE_NEGOTIATED_CAPABILITIES: Record<string, boolean> = Object.freeze({
  'drive.navigate': true,
  'drive.go_back': true,
  'drive.go_forward': true,
  'drive.click': true,
  'drive.hover': true,
  'drive.select': true,
  'drive.type': true,
  'drive.fill_form': true,
  'drive.drag': true,
  'drive.handle_dialog': true,
  'drive.key': true,
  'drive.key_press': true,
  'drive.scroll': true,
  'drive.screenshot': true,
  'drive.wait_for': true,
  'drive.tab_list': true,
  'drive.tab_activate': true,
  'drive.tab_close': true,
  'drive.ping': true,
});

const DEBUGGER_CAPABILITY_ACTIONS = [
  'debugger.attach',
  'debugger.detach',
  'debugger.command',
] as const;

const buildNegotiatedCapabilities = (
  debuggerCapabilityEnabled: boolean
): Record<string, boolean> => {
  const capabilities: Record<string, boolean> = {
    ...BASE_NEGOTIATED_CAPABILITIES,
  };
  for (const action of DEBUGGER_CAPABILITY_ACTIONS) {
    capabilities[action] = debuggerCapabilityEnabled;
  }
  return capabilities;
};

const debuggerCapabilityDisabledError = (): DriveErrorInfo => {
  return {
    code: 'ATTACH_DENIED',
    message:
      'Debugger capability is disabled. Enable debugger-based inspect in extension options and retry.',
    retryable: false,
    details: {
      reason: 'debugger_capability_disabled',
      next_step:
        'Open Browser Bridge extension options, enable debugger-based inspect, then retry.',
    },
  };
};

const getAgentTabBootstrapUrl = (): string => {
  return typeof chrome.runtime?.getURL === 'function'
    ? chrome.runtime.getURL(AGENT_TAB_BOOTSTRAP_PATH)
    : AGENT_TAB_BOOTSTRAP_PATH;
};

const getAgentTabFaviconUrl = (): string => {
  return typeof chrome.runtime?.getURL === 'function'
    ? chrome.runtime.getURL(AGENT_TAB_FAVICON_ASSET_PATH)
    : AGENT_TAB_FAVICON_ASSET_PATH;
};

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

const CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS = 400;
const CAPTURE_VISIBLE_TAB_MAX_RETRIES = 3;
const CAPTURE_VISIBLE_TAB_RETRY_BASE_DELAY_MS = 500;

let captureVisibleTabQueue: Promise<void> = Promise.resolve();
let captureVisibleTabLastCallAt = 0;

const randomJitterMs = (maxMs: number): number => {
  return Math.floor(Math.random() * Math.max(1, maxMs));
};

const runCaptureVisibleTabOperation = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const previous = captureVisibleTabQueue;
  let releaseQueue: (() => void) | undefined;
  captureVisibleTabQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseQueue?.();
  }
};

const captureVisibleTabWithThrottle = async (
  windowId: number
): Promise<string> => {
  return await runCaptureVisibleTabOperation(async () => {
    for (
      let attempt = 0;
      attempt <= CAPTURE_VISIBLE_TAB_MAX_RETRIES;
      attempt += 1
    ) {
      const waitMs =
        captureVisibleTabLastCallAt +
        CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS -
        Date.now();
      if (waitMs > 0) {
        await delayMs(waitMs);
      }

      try {
        const dataUrl = await wrapChromeCallback<string>((callback) =>
          chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, callback)
        );
        captureVisibleTabLastCallAt = Date.now();
        return dataUrl;
      } catch (error) {
        captureVisibleTabLastCallAt = Date.now();
        if (
          !isCaptureVisibleTabRateLimitedError(error) ||
          attempt >= CAPTURE_VISIBLE_TAB_MAX_RETRIES
        ) {
          throw error;
        }

        const backoffMs =
          CAPTURE_VISIBLE_TAB_RETRY_BASE_DELAY_MS * (attempt + 1) +
          randomJitterMs(120);
        await delayMs(backoffMs);
      }
    }
    throw new Error('captureVisibleTab failed unexpectedly.');
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

const readCoreEndpointConfig = async (): Promise<CoreEndpointConfig> => {
  return await new Promise<CoreEndpointConfig>((resolve) => {
    chrome.storage.local.get(
      [CORE_PORT_KEY],
      (result: Record<string, unknown>) => {
        const raw = result?.[CORE_PORT_KEY];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          resolve({
            host: '127.0.0.1',
            port: raw,
            portSource: 'storage',
          });
          return;
        }
        if (typeof raw === 'string') {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            resolve({
              host: '127.0.0.1',
              port: parsed,
              portSource: 'storage',
            });
            return;
          }
        }
        resolve({
          host: '127.0.0.1',
          port: DEFAULT_CORE_PORT,
          portSource: 'default',
        });
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

  let lastError: unknown;
  for (const retryDelayMs of AGENT_TAB_GROUP_RETRY_DELAYS_MS) {
    if (retryDelayMs > 0) {
      await delayMs(retryDelayMs);
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
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.debug('Failed to create/update agent tab group.', lastError);
};

const ensureAgentTabGroupForTab = async (
  tabId: number,
  tab: Record<string, unknown>
): Promise<void> => {
  const windowId = tab.windowId;
  if (typeof windowId !== 'number') {
    return;
  }
  await ensureAgentTabGroup(tabId, windowId);
};

const createAgentWindow = async (): Promise<number> => {
  const created = await wrapChromeCallback<Record<string, unknown>>(
    (callback) =>
      chrome.windows.create(
        { url: getAgentTabBootstrapUrl(), focused: true },
        callback
      )
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
      await ensureAgentTabGroupForTab(agentTabId, tab);
      void refreshAgentTabBranding(agentTabId);
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
      await ensureAgentTabGroupForTab(stored, tab);
      void refreshAgentTabBranding(stored);
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
  params?: Record<string, unknown>,
  options?: { timeoutMs?: number }
): Promise<ContentResult> => {
  const timeoutMs =
    typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.floor(options.timeoutMs))
      : DEFAULT_SEND_TO_TAB_TIMEOUT_MS;

  const attemptSend = async (): Promise<ContentResult> => {
    return await new Promise<ContentResult>((resolve) => {
      const message: ContentRequest = { action, params };
      let settled = false;
      const finish = (result: ContentResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        resolve(result);
      };
      let timeout: number | undefined;
      timeout = self.setTimeout(() => {
        finish({
          ok: false,
          error: {
            code: 'TIMEOUT',
            message: `Timed out waiting for content response after ${timeoutMs}ms.`,
            retryable: true,
            details: {
              action,
              tab_id: tabId,
              timeout_ms: timeoutMs,
            },
          },
        });
      }, timeoutMs);
      chrome.tabs.sendMessage(tabId, message, (response: ContentResult) => {
        const error = chrome.runtime.lastError;
        if (error) {
          const retryable = isTransientTabChannelError(error.message);
          finish({
            ok: false,
            error: {
              code: 'EVALUATION_FAILED',
              message: error.message,
              retryable,
              ...(retryable
                ? {
                    details: {
                      reason: 'transient_tab_channel_error',
                    },
                  }
                : {}),
            },
          });
          return;
        }
        if (!response || typeof response !== 'object') {
          finish({
            ok: false,
            error: {
              code: 'EVALUATION_FAILED',
              message: 'Empty response from content script.',
              retryable: false,
            },
          });
          return;
        }
        finish(response);
      });
    });
  };

  // After navigation, MV3 message channels can close briefly while the content
  // script reattaches (for example, BFCache/page lifecycle transitions).
  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptSend();
    if (result.ok) {
      return result;
    }
    if (!isTransientTabChannelError(result.error?.message)) {
      return result;
    }
    const retryDelayMs = getTabChannelRetryDelayMs(attempt);
    if (retryDelayMs === undefined) {
      return result;
    }
    await delayMs(retryDelayMs);
  }
};

const refreshAgentTabBranding = async (tabId: number): Promise<void> => {
  const result = await sendToTab(
    tabId,
    AGENT_TAB_BRANDING_ACTION,
    { favicon_url: getAgentTabFaviconUrl() },
    { timeoutMs: AGENT_TAB_BRANDING_TIMEOUT_MS }
  );
  if (!result.ok) {
    return;
  }
};

const waitForHistoryNavigationSignal = async (
  tabId: number,
  timeoutMs: number
): Promise<void> => {
  return await new Promise<void>((resolve, reject) => {
    let timeout: number | undefined;
    const cleanup = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(
        onHistoryStateUpdated
      );
      chrome.webNavigation.onReferenceFragmentUpdated.removeListener(
        onReferenceFragmentUpdated
      );
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };

    const resolveSignal = () => {
      cleanup();
      resolve();
    };

    const onCommitted = (details: { tabId: number; frameId: number }) => {
      if (details.tabId !== tabId || details.frameId !== 0) {
        return;
      }
      resolveSignal();
    };

    const onHistoryStateUpdated = (details: {
      tabId: number;
      frameId: number;
    }) => {
      if (details.tabId !== tabId || details.frameId !== 0) {
        return;
      }
      resolveSignal();
    };

    const onReferenceFragmentUpdated = (details: {
      tabId: number;
      frameId: number;
    }) => {
      if (details.tabId !== tabId || details.frameId !== 0) {
        return;
      }
      resolveSignal();
    };

    const onTabUpdated = (
      updatedTabId: number,
      changeInfo: Record<string, unknown>
    ) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (typeof changeInfo.url !== 'string' || changeInfo.url.length === 0) {
        return;
      }
      resolveSignal();
    };

    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.webNavigation.onHistoryStateUpdated.addListener(
      onHistoryStateUpdated
    );
    chrome.webNavigation.onReferenceFragmentUpdated.addListener(
      onReferenceFragmentUpdated
    );
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    timeout = self.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for history navigation signal.'));
    }, timeoutMs);
  });
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

const getWsEndpoint = async (): Promise<{
  endpoint: CoreEndpointConfig;
  url: string;
}> => {
  const endpoint = await readCoreEndpointConfig();
  return {
    endpoint,
    url: `ws://${endpoint.host}:${endpoint.port}${CORE_WS_PATH}`,
  };
};

const getHealthEndpoint = (endpoint: CoreEndpointConfig): string =>
  `http://${endpoint.host}:${endpoint.port}${CORE_HEALTH_PATH}`;

class DriveSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 10000;
  private keepAliveTimer: number | null = null;
  private readonly keepAliveIntervalMs = 30000;
  private readonly debuggerSessions = new Map<number, DebuggerSession>();
  private debuggerIdleTimeoutMs: number | null = null;
  private readonly connection = new ConnectionStateTracker();

  start(): void {
    this.connection.markConnecting();
    void this.connect().catch((error) => {
      this.recordConnectionFailure('initial connect', error);
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
    this.connection.markDisconnected();
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
    this.connection.markBackoff(delay);
    this.reconnectTimer = self.setTimeout(() => {
      this.reconnectTimer = null;
      this.connection.markConnecting();
      void this.connect().catch((error) => {
        this.recordConnectionFailure('reconnect', error);
      });
    }, delay);
    this.reconnectDelayMs = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectDelayMs * 2
    );
  }

  private async connect(): Promise<void> {
    const { endpoint, url } = await getWsEndpoint();
    this.connection.setEndpoint(endpoint);
    const health = await this.checkCoreHealth(endpoint);
    if (!health.ok) {
      this.connection.markDisconnected();
      this.recordConnectionFailure(
        'core unavailable',
        new Error(health.detail)
      );
      this.scheduleReconnect();
      return;
    }
    try {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.reconnectDelayMs = 1000;
        this.connection.markConnected();
        const suppressed = this.connection.flushSuppressedFailureLogs();
        if (suppressed > 0) {
          console.info(
            `DriveSocket reconnected after suppressing ${suppressed} repeated connection failures.`
          );
        }
        this.startKeepAlive();
        void this.sendHello().catch((error) => {
          console.error('DriveSocket hello failed:', error);
        });
      });

      socket.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener('close', () => {
        this.handleSocketUnavailable(socket, 'socket closed');
      });

      socket.addEventListener('error', () => {
        this.handleSocketUnavailable(socket, 'socket error');
      });
    } catch (error) {
      this.recordConnectionFailure('connect', error);
      this.connection.markDisconnected();
      this.scheduleReconnect();
    }
  }

  private async checkCoreHealth(endpoint: CoreEndpointConfig): Promise<{
    ok: boolean;
    detail: string;
  }> {
    const controller = new AbortController();
    const timeoutId = self.setTimeout(() => {
      controller.abort();
    }, CORE_HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(getHealthEndpoint(endpoint), {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          detail: `health returned HTTP ${response.status}`,
        };
      }
      return { ok: true, detail: 'ok' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          ok: false,
          detail: `health timed out after ${CORE_HEALTH_TIMEOUT_MS}ms`,
        };
      }
      return {
        ok: false,
        detail:
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'health check failed',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  getConnectionStatus(): ReturnType<ConnectionStateTracker['getStatus']> {
    return this.connection.getStatus();
  }

  refreshCapabilities(): void {
    void this.sendHello().catch((error) => {
      console.error('DriveSocket refreshCapabilities failed:', error);
    });
  }

  private handleSocketUnavailable(socket: WebSocket, reason: string): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.stopKeepAlive();
    this.connection.markDisconnected();
    this.recordConnectionFailure(reason, new Error(reason));
    this.scheduleReconnect();
  }

  private recordConnectionFailure(context: string, error: unknown): void {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error';
    this.connection.recordFailure(`${context}: ${detail}`);
    const budget = this.connection.consumeFailureLogBudget();
    if (!budget.shouldLog) {
      return;
    }
    if (budget.suppressedCount > 0) {
      console.warn(
        `DriveSocket ${context} failed (${budget.suppressedCount} repeated failures suppressed).`,
        error
      );
      return;
    }
    console.warn(`DriveSocket ${context} failed.`, error);
  }

  private async sendHello(): Promise<void> {
    const manifest = chrome.runtime.getManifest();
    const endpoint = await readCoreEndpointConfig();
    const debuggerCapabilityEnabled = await readDebuggerCapabilityEnabled();
    let tabs: DriveTabInfo[] = [];
    try {
      tabs = await queryTabs();
    } catch (error) {
      console.debug('DriveSocket sendHello failed to read tabs.', error);
      tabs = [];
    }
    const params: DriveHelloParams = {
      extension_id: chrome.runtime.id,
      version: manifest.version,
      protocol_version: DRIVE_WS_PROTOCOL_VERSION,
      capabilities: buildNegotiatedCapabilities(debuggerCapabilityEnabled),
      core_host: endpoint.host,
      core_port: endpoint.port,
      core_port_source: endpoint.portSource,
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

  async refreshDebuggerCapabilityState(): Promise<void> {
    const enabled = await readDebuggerCapabilityEnabled();
    if (!enabled) {
      await this.detachAllDebuggerSessions();
    }
    this.refreshCapabilities();
  }

  async handleDebuggerCapabilityChange(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.detachAllDebuggerSessions();
    }
    this.refreshCapabilities();
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
        if (!(await readDebuggerCapabilityEnabled())) {
          this.sendMessage({
            id: message.id,
            action: message.action,
            status: 'error',
            error: sanitizeDriveErrorInfo(debuggerCapabilityDisabledError()),
          });
          return;
        }
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
          const domContentLoadedSignal =
            waitMode === 'domcontentloaded'
              ? waitForDomContentLoaded(tabId as number, 30000)
              : null;
          const warnings: string[] = [];
          await wrapChromeVoid((callback) =>
            chrome.tabs.update(tabId as number, { url }, () => callback())
          );
          markTabActive(tabId as number);
          if (domContentLoadedSignal) {
            try {
              await domContentLoadedSignal;
            } catch (error) {
              const tab = await getTab(tabId as number).catch(() => undefined);
              if (
                tab &&
                isLikelyNavigationCommitted(url, tab.url ?? undefined)
              ) {
                warnings.push(
                  'Timed out waiting for DOMContentLoaded, but the tab URL already updated to the requested target.'
                );
              } else {
                respondError({
                  code: 'TIMEOUT',
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Timed out waiting.',
                  retryable: true,
                });
                return;
              }
            }
          }
          if (tabId === agentTabId) {
            void refreshAgentTabBranding(tabId as number);
          }
          respondOk({
            ok: true,
            ...(warnings.length > 0 ? { warnings } : {}),
          });
          return;
        }
        case 'drive.go_back':
        case 'drive.go_forward': {
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
          const navigationSignal = waitForHistoryNavigationSignal(
            tabId as number,
            HISTORY_NAVIGATION_SIGNAL_TIMEOUT_MS
          );
          const result = await sendToTab(
            tabId as number,
            message.action,
            undefined,
            {
              timeoutMs: HISTORY_DISPATCH_TIMEOUT_MS,
            }
          );
          if (!result.ok && result.error.code !== 'TIMEOUT') {
            respondError(result.error);
            return;
          }
          markTabActive(tabId as number);
          try {
            await navigationSignal;
            try {
              await waitForDomContentLoaded(
                tabId as number,
                HISTORY_POST_NAV_DOM_GRACE_TIMEOUT_MS
              );
            } catch {
              // BFCache/history restores can skip DOMContentLoaded; proceed once
              // we have a confirmed top-level navigation signal.
            }
          } catch {
            if (!result.ok) {
              respondError({
                ...result.error,
              });
              return;
            }
          }
          if (tabId === agentTabId) {
            void refreshAgentTabBranding(tabId as number);
          }
          respondOk({
            ok: true,
          });
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
        case 'drive.key_press': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const key = params.key;
          if (typeof key !== 'string' || key.length === 0) {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'key must be a non-empty string.',
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
            await this.dispatchCdpKeyPress(
              tabId as number,
              key,
              params.modifiers
            );
            respondOk({ ok: true });
          } catch (error) {
            const info = mapDebuggerErrorMessage(
              error instanceof Error
                ? error.message
                : 'Keyboard dispatch failed.'
            );
            respondError(info);
          }
          return;
        }
        case 'drive.key': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const key = params.key;
          if (typeof key !== 'string' || key.length === 0) {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'key must be a non-empty string.',
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
          const count =
            typeof params.repeat === 'number' && Number.isFinite(params.repeat)
              ? Math.max(1, Math.min(50, Math.floor(params.repeat)))
              : 1;
          const error = await this.ensureDebuggerAttached(tabId as number);
          if (error) {
            respondError(error);
            return;
          }
          try {
            for (let i = 0; i < count; i += 1) {
              await this.dispatchCdpKeyPress(
                tabId as number,
                key,
                params.modifiers
              );
            }
            respondOk({ ok: true });
          } catch (error) {
            const info = mapDebuggerErrorMessage(
              error instanceof Error
                ? error.message
                : 'Keyboard dispatch failed.'
            );
            respondError(info);
          }
          return;
        }
        case 'drive.type': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const text = params.text;
          if (typeof text !== 'string') {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'text must be a string.',
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
          const result = await this.performCdpType(tabId as number, {
            locator: params.locator,
            text,
            clear: Boolean(params.clear),
            submit: Boolean(params.submit),
          });
          if (!result.ok) {
            respondError(result.error);
            return;
          }
          respondOk({ ok: true });
          return;
        }
        case 'drive.select': {
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
          try {
            await this.dispatchCdpClick(
              tabId as number,
              pointResult.point.x,
              pointResult.point.y,
              1
            );
          } catch (error) {
            const info = mapDebuggerErrorMessage(
              error instanceof Error ? error.message : 'Select click failed.'
            );
            respondError(info);
            return;
          }
          // CDP has no direct "select option by value/text/index" primitive.
          // Fall back explicitly to the existing select helper after CDP focus.
          const selectResult = await sendToTab(
            tabId as number,
            'drive.select',
            params
          );
          if (!selectResult.ok) {
            respondError(selectResult.error);
            return;
          }
          respondOk(selectResult.result ?? { ok: true });
          return;
        }
        case 'drive.fill_form': {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const fields = params.fields;
          if (!Array.isArray(fields) || fields.length === 0) {
            respondError({
              code: 'INVALID_ARGUMENT',
              message: 'fields must be a non-empty array.',
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
          let filled = 0;
          const errors: string[] = [];
          for (let index = 0; index < fields.length; index += 1) {
            const field = fields[index];
            if (!field || typeof field !== 'object') {
              errors.push(`Field ${index} is not an object.`);
              continue;
            }
            const record = field as Record<string, unknown>;
            const value = record.value;
            if (typeof value !== 'string' && typeof value !== 'boolean') {
              errors.push(`Field ${index} has invalid value.`);
              continue;
            }
            const selector =
              typeof record.selector === 'string' ? record.selector : undefined;
            const locator =
              record.locator && typeof record.locator === 'object'
                ? (record.locator as Record<string, unknown>)
                : selector
                  ? ({ css: selector } as Record<string, unknown>)
                  : undefined;
            let resolvedType =
              typeof record.type === 'string' && record.type.length > 0
                ? record.type
                : 'auto';
            if (resolvedType === 'auto') {
              const detected = await sendToTab(
                tabId as number,
                'drive.detect_field_type',
                { locator: record.locator, selector }
              );
              if (!detected.ok) {
                errors.push(`Field ${index} could not be resolved.`);
                continue;
              }
              const payload = detected.result;
              if (!payload || typeof payload !== 'object') {
                errors.push(`Field ${index} returned invalid type payload.`);
                continue;
              }
              const detectedType = (payload as Record<string, unknown>)
                .fieldType;
              if (
                typeof detectedType !== 'string' ||
                detectedType.length === 0
              ) {
                errors.push(`Field ${index} returned invalid field type.`);
                continue;
              }
              resolvedType = detectedType;
            }

            if (
              (resolvedType === 'text' || resolvedType === 'contentEditable') &&
              locator
            ) {
              const typed = await this.performCdpType(tabId as number, {
                locator,
                text: String(value),
                clear: true,
                submit: Boolean(record.submit),
              });
              if (!typed.ok) {
                errors.push(
                  `Field ${index} could not be filled: ${typed.error.message}`
                );
                continue;
              }
              filled += 1;
              continue;
            }

            // Explicit fallback for controls not yet modeled via CDP-first helper.
            const fallback = await sendToTab(
              tabId as number,
              'drive.fill_form',
              {
                fields: [field],
              }
            );
            if (!fallback.ok) {
              errors.push(
                `Field ${index} could not be filled: ${fallback.error.message}`
              );
              continue;
            }
            const payload = fallback.result;
            if (!payload || typeof payload !== 'object') {
              errors.push(`Field ${index} returned invalid fallback payload.`);
              continue;
            }
            const fallbackFilled = (payload as Record<string, unknown>).filled;
            if (
              typeof fallbackFilled === 'number' &&
              Number.isFinite(fallbackFilled) &&
              fallbackFilled > 0
            ) {
              filled += 1;
              continue;
            }
            errors.push(`Field ${index} could not be filled.`);
          }
          respondOk({
            filled,
            attempted: fields.length,
            errors: errors.length > 0 ? errors : [],
          });
          return;
        }
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
          const timeoutMs =
            message.action === 'drive.wait_for' &&
            typeof params.timeout_ms === 'number' &&
            Number.isFinite(params.timeout_ms)
              ? Math.max(1, Math.floor(params.timeout_ms) + 1000)
              : undefined;
          const result = await sendToTab(
            tabId as number,
            message.action,
            params,
            {
              timeoutMs,
            }
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
            return await captureVisibleTabWithThrottle(windowId);
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
              respondError(
                mapScreenshotCaptureError(
                  error,
                  'Failed to capture screenshot.'
                )
              );
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
              respondError(
                mapScreenshotCaptureError(
                  error,
                  'Failed to capture element screenshot.'
                )
              );
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
            respondError(
              mapScreenshotCaptureError(
                error,
                'Failed to capture full page screenshot.'
              )
            );
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

  private async performCdpType(
    tabId: number,
    options: {
      locator: unknown;
      text: string;
      clear: boolean;
      submit: boolean;
    }
  ): Promise<{ ok: true } | { ok: false; error: DriveErrorInfo }> {
    const targetPoint = await sendToTab(tabId, 'drive.type_target_point', {
      locator: options.locator,
    });
    if (!targetPoint.ok) {
      return targetPoint;
    }
    const payload = targetPoint.result;
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        error: {
          code: 'EVALUATION_FAILED',
          message: 'Invalid type target payload.',
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
          message: 'Invalid type target coordinates.',
          retryable: false,
        },
      };
    }
    try {
      await this.dispatchCdpClick(tabId, x, y, 1);
      if (options.clear) {
        const clearResult = await sendToTab(
          tabId,
          'drive.clear_active_editable'
        );
        if (!clearResult.ok) {
          return clearResult;
        }
      }
      if (options.text.length > 0) {
        await this.sendDebuggerCommand(
          tabId,
          'Input.insertText',
          { text: options.text },
          DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
        );
      }
      if (options.submit) {
        await this.dispatchCdpKeyPress(tabId, 'Enter', undefined);
      }
      this.touchDebuggerSession(tabId);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: mapDebuggerErrorMessage(
          error instanceof Error ? error.message : 'Type dispatch failed.'
        ),
      };
    }
  }

  private normalizeModifierMask(modifiers: unknown): number {
    const MOD_ALT = 1;
    const MOD_CTRL = 2;
    const MOD_META = 4;
    const MOD_SHIFT = 8;
    let mask = 0;
    if (Array.isArray(modifiers)) {
      for (const modifier of modifiers) {
        if (typeof modifier !== 'string') {
          continue;
        }
        const normalized = modifier.toLowerCase();
        if (normalized === 'alt') {
          mask |= MOD_ALT;
        } else if (normalized === 'ctrl') {
          mask |= MOD_CTRL;
        } else if (normalized === 'meta') {
          mask |= MOD_META;
        } else if (normalized === 'shift') {
          mask |= MOD_SHIFT;
        }
      }
      return mask;
    }
    if (!modifiers || typeof modifiers !== 'object') {
      return mask;
    }
    const record = modifiers as Record<string, unknown>;
    if (record.alt) {
      mask |= MOD_ALT;
    }
    if (record.ctrl) {
      mask |= MOD_CTRL;
    }
    if (record.meta) {
      mask |= MOD_META;
    }
    if (record.shift) {
      mask |= MOD_SHIFT;
    }
    return mask;
  }

  private keyToCode(key: string): string {
    const map: Record<string, string> = {
      Enter: 'Enter',
      Tab: 'Tab',
      Escape: 'Escape',
      Esc: 'Escape',
      Backspace: 'Backspace',
      Delete: 'Delete',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ' ': 'Space',
      Space: 'Space',
    };
    if (map[key]) {
      return map[key];
    }
    if (key.length === 1) {
      if (/[a-zA-Z]/.test(key)) {
        return `Key${key.toUpperCase()}`;
      }
      if (/[0-9]/.test(key)) {
        return `Digit${key}`;
      }
    }
    return key;
  }

  private async dispatchCdpKeyPress(
    tabId: number,
    key: string,
    modifiers: unknown
  ): Promise<void> {
    const code = this.keyToCode(key);
    const modifierMask = this.normalizeModifierMask(modifiers);
    const isTextInput = key.length === 1 && (modifierMask & (1 | 2 | 4)) === 0;
    const keyDownParams: Record<string, unknown> = {
      type: 'keyDown',
      key,
      code,
      modifiers: modifierMask,
    };
    if (isTextInput) {
      keyDownParams.text = key;
      keyDownParams.unmodifiedText = key;
    }

    await this.sendDebuggerCommand(
      tabId,
      'Input.dispatchKeyEvent',
      keyDownParams,
      DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
    );
    await this.sendDebuggerCommand(
      tabId,
      'Input.dispatchKeyEvent',
      {
        type: 'keyUp',
        key,
        code,
        modifiers: modifierMask,
      },
      DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS
    );
    this.touchDebuggerSession(tabId);
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
    if (!(await readDebuggerCapabilityEnabled())) {
      return;
    }
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
    if (!(await readDebuggerCapabilityEnabled())) {
      return;
    }
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

  private async detachAllDebuggerSessions(): Promise<void> {
    const tabIds = Array.from(this.debuggerSessions.keys());
    for (const tabId of tabIds) {
      const error = await this.detachDebugger(tabId);
      if (error) {
        console.warn('DriveSocket detachDebugger failed:', tabId, error);
      }
    }
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

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void
  ) => {
    if (!message || typeof message !== 'object') {
      return undefined;
    }
    const action = (message as { action?: unknown }).action;
    if (action === 'drive.connection_status') {
      sendResponse({
        ok: true,
        result: socket.getConnectionStatus(),
      });
      return true;
    }
    if (action === 'drive.refresh_capabilities') {
      void socket
        .refreshDebuggerCapabilityState()
        .then(() => {
          sendResponse({ ok: true, result: { refreshed: true } });
        })
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to refresh capabilities.';
          sendResponse({ ok: false, error: { message } });
        });
      return true;
    }
    return undefined;
  }
);

chrome.storage.onChanged.addListener(
  (changes: Record<string, StorageChange>, areaName: string) => {
    if (areaName !== 'local') {
      return;
    }
    const debuggerChange = changes[DEBUGGER_CAPABILITY_ENABLED_KEY];
    if (!debuggerChange) {
      return;
    }
    if (typeof debuggerChange.newValue === 'boolean') {
      void socket
        .handleDebuggerCapabilityChange(debuggerChange.newValue)
        .catch((error) => {
          console.error(
            'DriveSocket handleDebuggerCapabilityChange failed:',
            error
          );
        });
      return;
    }
    void socket.refreshDebuggerCapabilityState().catch((error) => {
      console.error(
        'DriveSocket refreshDebuggerCapabilityState failed:',
        error
      );
    });
  }
);

socket.start();
