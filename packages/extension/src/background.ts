import type {
  DebuggerCommandParams,
  DebuggerEvent,
  DebuggerRequest,
  DriveErrorInfo,
  DriveEvent,
  DriveHelloParams,
  DriveResponse,
  DriveTabInfo,
  DriveTabListResult,
  ExtensionMessage,
  ExtensionRequest,
} from './protocol.js';

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
};

const DEFAULT_CORE_PORT = 3210;
const CORE_PORT_KEY = 'corePort';
const CORE_WS_PATH = '/drive';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEBUGGER_IDLE_TIMEOUT_KEY = 'debuggerIdleTimeoutMs';
const DEFAULT_DEBUGGER_IDLE_TIMEOUT_MS = 15000;
const DEFAULT_DEBUGGER_COMMAND_TIMEOUT_MS = 10000;

const nowIso = (): string => new Date().toISOString();

const makeEventId = (() => {
  let counter = 0;
  return () => `evt-${Date.now()}-${(counter += 1)}`;
})();

const lastActiveAtByTab = new Map<number, string>();

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
    console.debug("Ignoring invalid URL in restriction check.", error);
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
      message,
      retryable: true,
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

const sendToTab = async (
  tabId: number,
  action: string,
  params?: Record<string, unknown>
): Promise<ContentResult> => {
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
      console.error("DriveSocket connect failed:", error);
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
      console.error("DriveSocket emitTabReport failed:", error);
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
        console.error("DriveSocket reconnect failed:", error);
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
          console.error("DriveSocket hello failed:", error);
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
      console.debug("DriveSocket connect failed, scheduling reconnect.", error);
      this.scheduleReconnect();
    }
  }

  private async sendHello(): Promise<void> {
    const manifest = chrome.runtime.getManifest();
    let tabs: DriveTabInfo[] = [];
    try {
      tabs = await queryTabs();
    } catch (error) {
      console.debug("DriveSocket sendHello failed to read tabs.", error);
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
    const driveMessage = message as DriveRequest;
    const respondOk = (result?: unknown): void => {
      const response: DriveResponse = {
        id: driveMessage.id,
        action: driveMessage.action,
        status: 'ok',
        result,
      };
      this.sendMessage(response);
    };

    const respondError = (error: DriveErrorInfo): void => {
      const response: DriveResponse = {
        id: driveMessage.id,
        action: driveMessage.action,
        status: 'error',
        error,
      };
      this.sendMessage(response);
    };

    try {
      if (
        typeof message.action === 'string' &&
        message.action.startsWith('debugger.')
      ) {
        await this.handleDebuggerRequest(message as DebuggerRequest);
        return;
      }
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
            tabId = await getActiveTabId();
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
            tabId = await getActiveTabId();
          }
          try {
            const isBack =
              message.action === 'drive.go_back' || message.action === 'drive.back';
            await wrapChromeVoid((callback) => {
              if (isBack) {
                chrome.tabs.goBack(tabId as number, () => callback());
              } else {
                chrome.tabs.goForward(tabId as number, () => callback());
              }
            });
          } catch (error) {
            respondError({
              code: 'FAILED_PRECONDITION',
              message: error instanceof Error ? error.message : 'No history entry.',
              retryable: false,
            });
            return;
          }
          markTabActive(tabId as number);
          try {
            await waitForDomContentLoaded(tabId as number, 30000);
          } catch (error) {
            respondError({
              code: 'TIMEOUT',
              message: error instanceof Error ? error.message : 'Timed out waiting.',
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
            tabId = await getActiveTabId();
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
        case 'drive.click':
        case 'drive.hover':
        case 'drive.select':
        case 'drive.type':
        case 'drive.fill_form':
        case 'drive.drag':
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
            tabId = await getActiveTabId();
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
        error,
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
        console.debug("Debugger attach promise failed before detach.", error);
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
      console.error("DriveSocket refreshDebuggerIdleTimer failed:", error);
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
        console.error("DriveSocket detachDebugger failed:", error);
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
  lastActiveAtByTab.delete(tabId);
  socket.sendTabReport();
});

chrome.debugger.onEvent.addListener(
  (source: DebuggerTarget, method: string, params: Record<string, unknown>) => {
    void socket.handleDebuggerEvent(source, method, params).catch((error) => {
      console.error("DriveSocket handleDebuggerEvent failed:", error);
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
