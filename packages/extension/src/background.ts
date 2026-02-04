import type {
  DriveErrorInfo,
  DriveEvent,
  DriveHelloParams,
  DriveMessage,
  DriveRequest,
  DriveResponse,
  DriveTabInfo,
  DriveTabListResult,
} from "./protocol.js";

type ContentResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: DriveErrorInfo };

type ContentRequest = {
  action: string;
  params?: Record<string, unknown>;
};

const DEFAULT_CORE_PORT = 3210;
const CORE_PORT_KEY = "corePort";
const CORE_WS_PATH = "/drive";

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

const wrapChromeVoid = (invoker: (callback: () => void) => void): Promise<void> => {
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
    chrome.storage.local.get([CORE_PORT_KEY], (result: Record<string, unknown>) => {
      const raw = result?.[CORE_PORT_KEY];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        resolve(raw);
        return;
      }
      if (typeof raw === "string") {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          resolve(parsed);
          return;
        }
      }
      resolve(DEFAULT_CORE_PORT);
    });
  });
};

const buildTabInfo = (tab: Record<string, unknown>): DriveTabInfo | null => {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (typeof tabId !== "number" || typeof windowId !== "number") {
    return null;
  }
  return {
    tab_id: tabId,
    window_id: windowId,
    url: typeof tab.url === "string" ? tab.url : undefined,
    title: typeof tab.title === "string" ? tab.title : undefined,
    active: typeof tab.active === "boolean" ? tab.active : undefined,
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
  if (first && typeof first.id === "number") {
    return first.id;
  }
  throw new Error("No active tab found.");
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
            code: "EVALUATION_FAILED",
            message: error.message,
            retryable: false,
          },
        });
        return;
      }
      if (!response || typeof response !== "object") {
        resolve({
          ok: false,
          error: {
            code: "EVALUATION_FAILED",
            message: "Empty response from content script.",
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
      reject(new Error("Timed out waiting for domcontentloaded."));
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

  start(): void {
    void this.connect();
  }

  stop(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  sendTabReport(): void {
    void this.emitTabReport();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectTimer = self.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
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

      socket.addEventListener("open", () => {
        this.reconnectDelayMs = 1000;
        void this.sendHello();
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener("close", () => {
        this.socket = null;
        this.scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        this.socket = null;
        this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private async sendHello(): Promise<void> {
    const manifest = chrome.runtime.getManifest();
    let tabs: DriveTabInfo[] = [];
    try {
      tabs = await queryTabs();
    } catch {
      tabs = [];
    }
    const params: DriveHelloParams = {
      version: manifest.version,
      tabs,
    };
    this.sendEvent("drive.hello", params);
  }

  private async emitTabReport(): Promise<void> {
    try {
      const tabs = await queryTabs();
      this.sendEvent("drive.tab_report", { tabs });
    } catch {
      // Ignore tab reporting errors.
    }
  }

  private sendEvent(action: DriveEvent["action"], params: DriveEvent["params"]): void {
    const message: DriveEvent = {
      id: makeEventId(),
      action,
      status: "event",
      params,
    };
    this.sendMessage(message);
  }

  private sendMessage(message: DriveMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      return;
    }
    let message: DriveMessage | null = null;
    try {
      message = JSON.parse(raw) as DriveMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.status === "request") {
      void this.handleRequest(message as DriveRequest);
    }
  }

  private async handleRequest(message: DriveRequest): Promise<void> {
    const respondOk = (result?: unknown): void => {
      const response: DriveResponse = {
        id: message.id,
        action: message.action,
        status: "ok",
        result,
      };
      this.sendMessage(response);
    };

    const respondError = (error: DriveErrorInfo): void => {
      const response: DriveResponse = {
        id: message.id,
        action: message.action,
        status: "error",
        error,
      };
      this.sendMessage(response);
    };

    try {
      switch (message.action) {
        case "drive.navigate": {
          const params = (message.params ?? {}) as Record<string, unknown>;
          const url = params.url;
          if (typeof url !== "string" || url.length === 0) {
            respondError({
              code: "INVALID_ARGUMENT",
              message: "url must be a non-empty string.",
              retryable: false,
            });
            return;
          }
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== "number") {
            respondError({
              code: "INVALID_ARGUMENT",
              message: "tab_id must be a number when provided.",
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getActiveTabId();
          }
          const waitMode =
            params.wait === "none" || params.wait === "domcontentloaded"
              ? params.wait
              : "domcontentloaded";
          await wrapChromeVoid((callback) =>
            chrome.tabs.update(tabId as number, { url }, () => callback())
          );
          markTabActive(tabId as number);
          if (waitMode === "domcontentloaded") {
            try {
              await waitForDomContentLoaded(tabId as number, 30000);
            } catch (error) {
              respondError({
                code: "TIMEOUT",
                message: error instanceof Error ? error.message : "Timed out waiting.",
                retryable: true,
              });
              return;
            }
          }
          respondOk({ ok: true });
          return;
        }
        case "drive.tab_list": {
          const tabs = await queryTabs();
          const result: DriveTabListResult = { tabs };
          respondOk(result);
          return;
        }
        case "drive.tab_activate": {
          const tabId = (message.params as Record<string, unknown> | undefined)?.tab_id;
          if (typeof tabId !== "number") {
            respondError({
              code: "INVALID_ARGUMENT",
              message: "tab_id must be a number.",
              retryable: false,
            });
            return;
          }
          const tab = await getTab(tabId);
          await wrapChromeVoid((callback) =>
            chrome.tabs.update(tabId, { active: true }, () => callback())
          );
          const windowId = tab.windowId;
          if (typeof windowId === "number") {
            await wrapChromeVoid((callback) =>
              chrome.windows.update(windowId, { focused: true }, () => callback())
            );
          }
          markTabActive(tabId);
          respondOk({ ok: true });
          this.sendTabReport();
          return;
        }
        case "drive.tab_close": {
          const tabId = (message.params as Record<string, unknown> | undefined)?.tab_id;
          if (typeof tabId !== "number") {
            respondError({
              code: "INVALID_ARGUMENT",
              message: "tab_id must be a number.",
              retryable: false,
            });
            return;
          }
          await wrapChromeVoid((callback) => chrome.tabs.remove(tabId, () => callback()));
          lastActiveAtByTab.delete(tabId);
          respondOk({ ok: true });
          this.sendTabReport();
          return;
        }
        case "drive.click":
        case "drive.type":
        case "drive.scroll":
        case "drive.wait_for": {
          const params = (message.params ?? {}) as Record<string, unknown>;
          let tabId = params.tab_id;
          if (tabId !== undefined && typeof tabId !== "number") {
            respondError({
              code: "INVALID_ARGUMENT",
              message: "tab_id must be a number when provided.",
              retryable: false,
            });
            return;
          }
          if (tabId === undefined) {
            tabId = await getActiveTabId();
          }
          const result = await sendToTab(tabId as number, message.action, params);
          if (result.ok) {
            respondOk(result.result ?? { ok: true });
          } else {
            respondError(result.error);
          }
          return;
        }
        default:
          respondError({
            code: "NOT_IMPLEMENTED",
            message: `${message.action} not implemented in extension yet.`,
            retryable: false,
          });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown error";
      respondError({
        code: "EVALUATION_FAILED",
        message: messageText,
        retryable: false,
      });
    }
  }
}

const socket = new DriveSocket();

chrome.tabs.onActivated.addListener((activeInfo: { tabId: number }) => {
  markTabActive(activeInfo.tabId);
  socket.sendTabReport();
});

chrome.tabs.onCreated.addListener((tab: Record<string, unknown>) => {
  if (typeof tab.id === "number") {
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
      changeInfo.status === "complete";
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

socket.start();
