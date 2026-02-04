import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { RawData } from 'ws';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  DebuggerEvent,
  DebuggerRequestAction,
  DebuggerResponse,
  DriveAction,
  DriveErrorInfo,
  DriveResponse,
  DriveTabInfo,
  ExtensionEvent,
  ExtensionMessage,
  ExtensionRequest,
  ExtensionRequestAction,
  ExtensionResponse,
} from './drive-protocol';
import { SessionRegistry } from './session';
import { SessionState } from './state';

export type ExtensionBridgeStatus = {
  connected: boolean;
  lastSeenAt?: string;
  tabs: DriveTabInfo[];
};

type PendingRequest = {
  resolve: (response: ExtensionResponse) => void;
  reject: (error: ExtensionBridgeError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type DebuggerEventListener = (event: DebuggerEvent) => void;

export class ExtensionBridgeError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ExtensionBridgeError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export type ExtensionBridgeOptions = {
  path?: string;
  registry?: SessionRegistry;
};

export class ExtensionBridge {
  private readonly wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private lastSeenAt?: string;
  private tabs: DriveTabInfo[] = [];
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private awaitingHeartbeat = false;
  private readonly heartbeatIntervalMs = 15000;
  private readonly heartbeatTimeoutMs = 5000;
  private readonly path: string;
  private readonly registry?: SessionRegistry;
  private readonly debuggerListeners = new Set<DebuggerEventListener>();

  constructor(options: ExtensionBridgeOptions = {}) {
    this.wss = new WebSocketServer({ noServer: true });
    this.path = options.path ?? '/drive';
    this.registry = options.registry;

    this.wss.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  attach(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '', 'ws://127.0.0.1');
      if (url.pathname !== this.path) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ExtensionBridgeStatus {
    return {
      connected: this.connected,
      lastSeenAt: this.lastSeenAt,
      tabs: this.tabs,
    };
  }

  async request<T = unknown>(
    action: DriveAction,
    params?: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<DriveResponse<T>> {
    const response = await this.requestInternal(action, params, timeoutMs);
    return response as DriveResponse<T>;
  }

  async requestDebugger<T = unknown>(
    action: DebuggerRequestAction,
    params?: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<DebuggerResponse<T>> {
    const response = await this.requestInternal(action, params, timeoutMs);
    return response as DebuggerResponse<T>;
  }

  onDebuggerEvent(listener: DebuggerEventListener): () => void {
    this.debuggerListeners.add(listener);
    return () => {
      this.debuggerListeners.delete(listener);
    };
  }

  private async requestInternal(
    action: ExtensionRequestAction,
    params?: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<ExtensionResponse> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new ExtensionBridgeError(
        'EXTENSION_DISCONNECTED',
        'Extension is not connected.',
        true
      );
    }

    const id = randomUUID();
    const request: ExtensionRequest = {
      id,
      action,
      status: 'request',
      params,
    };

    const response = await new Promise<ExtensionResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ExtensionBridgeError(
            'TIMEOUT',
            `Extension request timed out after ${timeoutMs}ms.`,
            true,
            { action }
          )
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      });

      this.socket?.send(JSON.stringify(request));
    });

    return response;
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      return;
    }
    this.heartbeatInterval = setInterval(() => {
      void this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
    void this.sendHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.awaitingHeartbeat = false;
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.awaitingHeartbeat) {
      return;
    }
    this.awaitingHeartbeat = true;
    try {
      await this.requestInternal("drive.ping", undefined, this.heartbeatTimeoutMs);
    } catch (error) {
      console.warn("Extension heartbeat failed:", error);
      this.forceDisconnect();
    } finally {
      this.awaitingHeartbeat = false;
    }
  }

  private forceDisconnect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.terminate();
      } catch {
        this.socket.close();
      }
    }
    this.handleDisconnect();
  }

  private handleConnection(socket: WebSocket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }

    this.socket = socket;
    this.connected = true;
    this.lastSeenAt = new Date().toISOString();

    this.applyDriveConnected();
    this.startHeartbeat();

    socket.on('message', (data) => {
      this.handleMessage(data);
    });

    socket.on('close', () => {
      this.handleDisconnect();
    });

    socket.on('error', () => {
      this.handleDisconnect();
    });
  }

  private handleDisconnect(): void {
    if (!this.connected) {
      return;
    }

    this.stopHeartbeat();
    this.connected = false;
    this.socket = null;
    this.lastSeenAt = new Date().toISOString();
    this.applyDriveDisconnected();

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new ExtensionBridgeError(
          'EXTENSION_DISCONNECTED',
          'Extension disconnected before responding.',
          true,
          { request_id: id }
        )
      );
      this.pending.delete(id);
    }
  }

  private handleMessage(data: RawData): void {
    const text = typeof data === 'string' ? data : data.toString();

    let message: ExtensionMessage | null = null;
    try {
      message = JSON.parse(text) as ExtensionMessage;
    } catch {
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }

    this.lastSeenAt = new Date().toISOString();

    if (message.status === 'event') {
      this.handleEvent(message as ExtensionEvent);
      return;
    }

    if (
      message.status === 'ok' ||
      message.status === 'error' ||
      message.status === 'ack'
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      pending.resolve(message as ExtensionResponse);
    }
  }

  private handleEvent(message: ExtensionEvent): void {
    if (
      message.action === 'drive.hello' ||
      message.action === 'drive.tab_report'
    ) {
      const tabs = (message.params as { tabs?: DriveTabInfo[] } | undefined)
        ?.tabs;
      if (Array.isArray(tabs)) {
        this.tabs = tabs;
      }
    }

    if (
      typeof message.action === 'string' &&
      message.action.startsWith('debugger.')
    ) {
      this.emitDebuggerEvent(message as DebuggerEvent);
    }
  }

  private emitDebuggerEvent(event: DebuggerEvent): void {
    for (const listener of this.debuggerListeners) {
      try {
        listener(event);
      } catch (error) {
        console.debug("Debugger event listener failed.", error);
      }
    }
  }

  private applyDriveConnected(): void {
    if (!this.registry) {
      return;
    }

    for (const session of this.registry.list()) {
      try {
        if (session.state === SessionState.INIT) {
          this.registry.apply(session.id, 'DRIVE_CONNECTED');
        } else if (session.state === SessionState.INSPECT_READY) {
          this.registry.apply(session.id, 'DRIVE_CONNECTED');
        } else if (session.state === SessionState.DEGRADED_DRIVE) {
          this.registry.apply(session.id, 'RECOVER_SUCCEEDED');
        }
      } catch (error) {
        console.debug(
          `Drive connect transition ignored for session ${session.id} (${session.state}).`,
          error
        );
      }
    }
  }

  private applyDriveDisconnected(): void {
    if (!this.registry) {
      return;
    }

    for (const session of this.registry.list()) {
      try {
        if (session.state === SessionState.READY) {
          this.registry.apply(session.id, 'DRIVE_DISCONNECTED');
        }
      } catch (error) {
        console.debug(
          `Drive disconnect transition ignored for session ${session.id} (${session.state}).`,
          error
        );
      }
    }
  }
}

export const toDriveError = (error: ExtensionBridgeError): DriveErrorInfo => ({
  code: error.code,
  message: error.message,
  retryable: error.retryable,
  ...(error.details ? { details: error.details } : {}),
});
