import type {
  DebuggerEvent,
  DebuggerEventParams,
  DebuggerResponse,
  DriveErrorInfo,
} from './drive-protocol';
import {
  ExtensionBridge,
  ExtensionBridgeError,
  toDriveError,
} from './extension-bridge';

export type DebuggerEventRecord = {
  tab_id: number;
  method: string;
  params?: Record<string, unknown>;
  timestamp: string;
};

export type DebuggerResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: DriveErrorInfo };

export type DebuggerBridgeOptions = {
  extensionBridge: ExtensionBridge;
  consoleBufferSize?: number;
  networkBufferSize?: number;
  idleTimeoutMs?: number;
};

const DEFAULT_CONSOLE_BUFFER_SIZE = 200;
const DEFAULT_NETWORK_BUFFER_SIZE = 500;
const DEFAULT_IDLE_TIMEOUT_MS = 15000;

const CONSOLE_METHODS = new Set([
  'Runtime.consoleAPICalled',
  'Runtime.exceptionThrown',
  'Log.entryAdded',
]);

const isConsoleEvent = (method: string): boolean => {
  if (CONSOLE_METHODS.has(method)) {
    return true;
  }
  return method.startsWith('Runtime.') && method.includes('console');
};

const isNetworkEvent = (method: string): boolean =>
  method.startsWith('Network.');

class RingBuffer<T> {
  private readonly capacity: number;
  private readonly entries: T[] = [];

  constructor(capacity: number) {
    this.capacity = Math.max(0, capacity);
  }

  push(entry: T): void {
    if (this.capacity <= 0) {
      return;
    }
    if (this.entries.length >= this.capacity) {
      this.entries.shift();
    }
    this.entries.push(entry);
  }

  toArray(): T[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}

type DebuggerTabState = {
  attached: boolean;
  lastActivityAt: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  console: RingBuffer<DebuggerEventRecord>;
  network: RingBuffer<DebuggerEventRecord>;
};

export class DebuggerBridge {
  private readonly bridge: ExtensionBridge;
  private readonly consoleBufferSize: number;
  private readonly networkBufferSize: number;
  private readonly idleTimeoutMs: number;
  private readonly tabs = new Map<number, DebuggerTabState>();
  private lastError?: DriveErrorInfo;
  private lastErrorAt?: string;
  private readonly unsubscribe: () => void;

  constructor(options: DebuggerBridgeOptions) {
    this.bridge = options.extensionBridge;
    this.consoleBufferSize =
      options.consoleBufferSize ?? DEFAULT_CONSOLE_BUFFER_SIZE;
    this.networkBufferSize =
      options.networkBufferSize ?? DEFAULT_NETWORK_BUFFER_SIZE;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

    this.unsubscribe = this.bridge.onDebuggerEvent((event) => {
      this.handleDebuggerEvent(event);
    });
  }

  getLastError(): { error: DriveErrorInfo; at: string } | undefined {
    if (!this.lastError || !this.lastErrorAt) {
      return undefined;
    }
    return { error: this.lastError, at: this.lastErrorAt };
  }

  getSettings(): {
    idleTimeoutMs: number;
    consoleBufferSize: number;
    networkBufferSize: number;
  } {
    return {
      idleTimeoutMs: this.idleTimeoutMs,
      consoleBufferSize: this.consoleBufferSize,
      networkBufferSize: this.networkBufferSize,
    };
  }

  hasAttachments(): boolean {
    for (const state of this.tabs.values()) {
      if (state.attached) {
        return true;
      }
    }
    return false;
  }

  getConsoleEvents(tabId: number): DebuggerEventRecord[] {
    return this.ensureTab(tabId).console.toArray();
  }

  getNetworkEvents(tabId: number): DebuggerEventRecord[] {
    return this.ensureTab(tabId).network.toArray();
  }

  clearBuffers(tabId: number): void {
    const state = this.tabs.get(tabId);
    if (!state) {
      return;
    }
    state.console.clear();
    state.network.clear();
  }

  async attach(tabId: number): Promise<DebuggerResult<{ attached: boolean }>> {
    const state = this.ensureTab(tabId);
    if (state.attached) {
      this.touch(tabId, state);
      return { ok: true, result: { attached: true } };
    }

    try {
      const response = await this.bridge.requestDebugger(
        'debugger.attach',
        { tab_id: tabId },
        this.idleTimeoutMs
      );

      if (response.status === 'error') {
        const error =
          response.error ??
          ({
            code: 'INSPECT_UNAVAILABLE',
            message: 'Debugger attach failed.',
            retryable: false,
          } as DriveErrorInfo);
        this.recordError(error);
        return { ok: false, error };
      }

      state.attached = true;
      this.touch(tabId, state);
      return { ok: true, result: { attached: true } };
    } catch (error) {
      const info = this.handleBridgeError(error);
      return { ok: false, error: info };
    }
  }

  async detach(tabId: number): Promise<DebuggerResult<{ attached: boolean }>> {
    const state = this.tabs.get(tabId);
    if (!state || !state.attached) {
      return { ok: true, result: { attached: false } };
    }

    try {
      const response = await this.bridge.requestDebugger(
        'debugger.detach',
        { tab_id: tabId },
        this.idleTimeoutMs
      );

      if (response.status === 'error') {
        const error =
          response.error ??
          ({
            code: 'INSPECT_UNAVAILABLE',
            message: 'Debugger detach failed.',
            retryable: false,
          } as DriveErrorInfo);
        this.recordError(error);
        return { ok: false, error };
      }

      this.markDetached(tabId);
      return { ok: true, result: { attached: false } };
    } catch (error) {
      const info = this.handleBridgeError(error);
      this.markDetached(tabId);
      return { ok: false, error: info };
    }
  }

  async command<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 10000
  ): Promise<DebuggerResult<T>> {
    const attachResult = await this.attach(tabId);
    if (!attachResult.ok) {
      return attachResult as DebuggerResult<T>;
    }

    try {
      const response: DebuggerResponse<T> = await this.bridge.requestDebugger(
        'debugger.command',
        {
          tab_id: tabId,
          method,
          params,
        },
        timeoutMs
      );

      if (response.status === 'error') {
        const error =
          response.error ??
          ({
            code: 'INSPECT_UNAVAILABLE',
            message: 'Debugger command failed.',
            retryable: false,
          } as DriveErrorInfo);
        this.recordError(error);
        return { ok: false, error };
      }

      this.touch(tabId, this.ensureTab(tabId));
      return { ok: true, result: response.result as T };
    } catch (error) {
      const info = this.handleBridgeError(error);
      return { ok: false, error: info };
    }
  }

  shutdown(): void {
    this.unsubscribe();
    for (const [tabId, state] of this.tabs) {
      if (state.idleTimer) {
        clearTimeout(state.idleTimer);
      }
      this.tabs.delete(tabId);
    }
  }

  private handleDebuggerEvent(event: DebuggerEvent): void {
    if (event.action !== 'debugger.event') {
      return;
    }

    const params = event.params as DebuggerEventParams | undefined;
    if (!params || typeof params.tab_id !== 'number') {
      return;
    }

    const record: DebuggerEventRecord = {
      tab_id: params.tab_id,
      method: params.method,
      params: params.params as Record<string, unknown> | undefined,
      timestamp: params.timestamp ?? new Date().toISOString(),
    };

    const state = this.ensureTab(params.tab_id);

    if (record.method === 'Debugger.detached') {
      this.markDetached(params.tab_id);
      return;
    }

    if (isConsoleEvent(record.method)) {
      state.console.push(record);
    } else if (isNetworkEvent(record.method)) {
      state.network.push(record);
    }

    this.touch(params.tab_id, state);
  }

  private ensureTab(tabId: number): DebuggerTabState {
    const existing = this.tabs.get(tabId);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const state: DebuggerTabState = {
      attached: false,
      lastActivityAt: now,
      console: new RingBuffer<DebuggerEventRecord>(this.consoleBufferSize),
      network: new RingBuffer<DebuggerEventRecord>(this.networkBufferSize),
    };
    this.tabs.set(tabId, state);
    return state;
  }

  private touch(tabId: number, state: DebuggerTabState): void {
    state.lastActivityAt = new Date().toISOString();
    this.scheduleIdleDetach(tabId, state);
  }

  private scheduleIdleDetach(tabId: number, state: DebuggerTabState): void {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }
    state.idleTimer = setTimeout(() => {
      void this.detach(tabId).catch((error) => {
        console.error("DebuggerBridge idle detach failed:", error);
      });
    }, this.idleTimeoutMs);
  }

  private markDetached(tabId: number): void {
    const state = this.tabs.get(tabId);
    if (!state) {
      return;
    }
    state.attached = false;
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }
  }

  private recordError(error: DriveErrorInfo): void {
    this.lastError = error;
    this.lastErrorAt = new Date().toISOString();
  }

  private handleBridgeError(error: unknown): DriveErrorInfo {
    if (error instanceof ExtensionBridgeError) {
      const info = toDriveError(error);
      this.recordError(info);
      return info;
    }

    const info: DriveErrorInfo = {
      code: 'INSPECT_UNAVAILABLE',
      message:
        error instanceof Error ? error.message : 'Debugger request failed.',
      retryable: false,
    };
    this.recordError(info);
    return info;
  }
}
