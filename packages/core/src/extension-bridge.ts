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
  DriveHelloParams,
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
import { DRIVE_WS_PROTOCOL_VERSION } from '@btraut/browser-bridge-shared';

export type ExtensionBridgeStatus = {
  connected: boolean;
  lastSeenAt?: string;
  version?: string;
  protocolVersion?: string;
  protocolMismatch?: {
    expected: string;
    received: string;
  };
  coreHost?: string;
  corePort?: number;
  corePortSource?: 'default' | 'storage';
  capabilityNegotiated: boolean;
  capabilities: Record<string, boolean>;
  tabs: DriveTabInfo[];
};

type PendingRequest = {
  resolve: (response: ExtensionResponse) => void;
  reject: (error: ExtensionBridgeError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type DebuggerEventListener = (event: DebuggerEvent) => void;

type CapabilityNegotiationFailure = {
  reason: 'missing_capabilities';
  expected: 'drive.hello.capabilities';
};

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
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
};

export class ExtensionBridge {
  private readonly wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private lastSeenAt?: string;
  private version?: string;
  private protocolVersion?: string;
  private protocolMismatch?: {
    expected: string;
    received: string;
  };
  private coreHost?: string;
  private corePort?: number;
  private corePortSource?: 'default' | 'storage';
  private capabilityNegotiated = false;
  private capabilityNegotiationFailure?: CapabilityNegotiationFailure;
  private capabilities: Record<string, boolean> = {};
  private tabs: DriveTabInfo[] = [];
  private badMessageLogsRemaining = 3;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private awaitingHeartbeat = false;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly path: string;
  private readonly registry?: SessionRegistry;
  private readonly debuggerListeners = new Set<DebuggerEventListener>();

  constructor(options: ExtensionBridgeOptions = {}) {
    this.wss = new WebSocketServer({ noServer: true });
    this.path = options.path ?? '/drive';
    this.registry = options.registry;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 5000;

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
      version: this.version,
      protocolVersion: this.protocolVersion,
      protocolMismatch: this.protocolMismatch,
      coreHost: this.coreHost,
      corePort: this.corePort,
      corePortSource: this.corePortSource,
      capabilityNegotiated: this.capabilityNegotiated,
      capabilities: this.capabilities,
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
    if (this.protocolMismatch && action !== 'drive.ping') {
      throw new ExtensionBridgeError(
        'FAILED_PRECONDITION',
        'Extension protocol version mismatch.',
        false,
        this.protocolMismatch
      );
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new ExtensionBridgeError(
        'EXTENSION_DISCONNECTED',
        'Extension is not connected.',
        true
      );
    }

    if (action !== 'drive.ping') {
      if (!this.capabilityNegotiated) {
        throw new ExtensionBridgeError(
          'FAILED_PRECONDITION',
          'Capability negotiation has not completed yet.',
          true,
          { action, expected: 'drive.hello.capabilities' }
        );
      }

      if (this.capabilityNegotiationFailure) {
        throw new ExtensionBridgeError(
          'FAILED_PRECONDITION',
          'Capability negotiation failed: extension hello payload is missing capabilities.',
          false,
          {
            action,
            ...this.capabilityNegotiationFailure,
          }
        );
      }

      if (this.capabilities[action] !== true) {
        throw new ExtensionBridgeError(
          'NOT_IMPLEMENTED',
          `Extension does not advertise capability for ${action}.`,
          false,
          { action }
        );
      }
    }

    const id = randomUUID();
    const request: ExtensionRequest =
      typeof action === 'string' && action.startsWith('debugger.')
        ? {
            id,
            action: action as DebuggerRequestAction,
            status: 'request',
            params,
          }
        : {
            id,
            action: action as DriveAction,
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
      await this.requestInternal(
        'drive.ping',
        undefined,
        this.heartbeatTimeoutMs
      );
    } catch (error) {
      console.warn('Extension heartbeat failed:', error);
      this.forceDisconnect();
    } finally {
      this.awaitingHeartbeat = false;
    }
  }

  private forceDisconnect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.terminate();
      } catch (error) {
        console.debug(
          'Extension socket terminate failed; falling back to close().',
          error
        );
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
    this.version = undefined;
    this.protocolVersion = undefined;
    this.protocolMismatch = undefined;
    this.coreHost = undefined;
    this.corePort = undefined;
    this.corePortSource = undefined;
    this.capabilityNegotiated = false;
    this.capabilityNegotiationFailure = undefined;
    this.capabilities = {};
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
    } catch (error) {
      if (this.badMessageLogsRemaining > 0) {
        this.badMessageLogsRemaining -= 1;
        console.debug('Failed to parse extension message.', error);
      }
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
      const params = message.params as DriveHelloParams | undefined;
      const tabs = params?.tabs;
      if (Array.isArray(tabs)) {
        this.tabs = tabs;
      }
      if (message.action === 'drive.hello') {
        if (typeof params?.version === 'string') {
          this.version = params.version;
        }
        if (typeof params?.protocol_version === 'string') {
          this.protocolVersion = params.protocol_version;
        } else {
          this.protocolVersion = undefined;
        }
        if (
          this.protocolVersion &&
          this.protocolVersion !== DRIVE_WS_PROTOCOL_VERSION
        ) {
          this.protocolMismatch = {
            expected: DRIVE_WS_PROTOCOL_VERSION,
            received: this.protocolVersion,
          };
        } else {
          this.protocolMismatch = undefined;
        }
        if (typeof params?.core_host === 'string') {
          this.coreHost = params.core_host;
        }
        if (
          typeof params?.core_port === 'number' &&
          Number.isFinite(params.core_port)
        ) {
          this.corePort = params.core_port;
        }
        if (
          params?.core_port_source === 'default' ||
          params?.core_port_source === 'storage'
        ) {
          this.corePortSource = params.core_port_source;
        }
        const capabilities = params?.capabilities;
        if (capabilities && typeof capabilities === 'object') {
          this.capabilities = Object.fromEntries(
            Object.entries(capabilities).filter(
              ([name, supported]) =>
                typeof name === 'string' && typeof supported === 'boolean'
            )
          );
          this.capabilityNegotiated = true;
          this.capabilityNegotiationFailure = undefined;
        } else {
          this.capabilities = {};
          this.capabilityNegotiated = true;
          this.capabilityNegotiationFailure = {
            reason: 'missing_capabilities',
            expected: 'drive.hello.capabilities',
          };
        }
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
        console.debug('Debugger event listener failed.', error);
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
  retry: {
    retryable: error.retryable,
    reason: String(error.code).toLowerCase(),
    max_attempts: 1,
  },
  ...(error.details ? { details: error.details } : {}),
});
