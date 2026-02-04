import { randomUUID } from "crypto";
import type { Server } from "http";
import type { RawData } from "ws";
import { WebSocketServer, WebSocket } from "ws";
import type {
  DriveAction,
  DriveErrorInfo,
  DriveEvent,
  DriveMessage,
  DriveRequest,
  DriveResponse,
  DriveTabInfo,
} from "./drive-protocol";
import { SessionRegistry } from "./session";
import { SessionState } from "./state";

export type ExtensionBridgeStatus = {
  connected: boolean;
  lastSeenAt?: string;
  tabs: DriveTabInfo[];
};

type PendingRequest = {
  resolve: (response: DriveResponse) => void;
  reject: (error: ExtensionBridgeError) => void;
  timeout: ReturnType<typeof setTimeout>;
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
    this.name = "ExtensionBridgeError";
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
  private readonly path: string;
  private readonly registry?: SessionRegistry;

  constructor(options: ExtensionBridgeOptions = {}) {
    this.wss = new WebSocketServer({ noServer: true });
    this.path = options.path ?? "/drive";
    this.registry = options.registry;

    this.wss.on("connection", (socket) => {
      this.handleConnection(socket);
    });
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "", "ws://127.0.0.1");
      if (url.pathname !== this.path) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
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
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new ExtensionBridgeError(
        "EXTENSION_DISCONNECTED",
        "Extension is not connected.",
        true
      );
    }

    const id = randomUUID();
    const request: DriveRequest = {
      id,
      action,
      status: "request",
      params,
    };

    const response = await new Promise<DriveResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ExtensionBridgeError(
            "TIMEOUT",
            `Drive request timed out after ${timeoutMs}ms.`,
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

    return response as DriveResponse<T>;
  }

  private handleConnection(socket: WebSocket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }

    this.socket = socket;
    this.connected = true;
    this.lastSeenAt = new Date().toISOString();

    this.applyDriveConnected();

    socket.on("message", (data) => {
      this.handleMessage(data);
    });

    socket.on("close", () => {
      this.handleDisconnect();
    });

    socket.on("error", () => {
      this.handleDisconnect();
    });
  }

  private handleDisconnect(): void {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.socket = null;
    this.lastSeenAt = new Date().toISOString();
    this.applyDriveDisconnected();

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new ExtensionBridgeError(
          "EXTENSION_DISCONNECTED",
          "Extension disconnected before responding.",
          true,
          { request_id: id }
        )
      );
      this.pending.delete(id);
    }
  }

  private handleMessage(data: RawData): void {
    const text = typeof data === "string" ? data : data.toString();

    let message: DriveMessage | null = null;
    try {
      message = JSON.parse(text) as DriveMessage;
    } catch {
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    this.lastSeenAt = new Date().toISOString();

    if (message.status === "event") {
      this.handleEvent(message as DriveEvent);
      return;
    }

    if (message.status === "ok" || message.status === "error") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      pending.resolve(message as DriveResponse);
    }
  }

  private handleEvent(message: DriveEvent): void {
    if (message.action === "drive.hello" || message.action === "drive.tab_report") {
      const tabs = (message.params as { tabs?: DriveTabInfo[] } | undefined)?.tabs;
      if (Array.isArray(tabs)) {
        this.tabs = tabs;
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
          this.registry.apply(session.id, "DRIVE_CONNECTED");
        } else if (session.state === SessionState.INSPECT_READY) {
          this.registry.apply(session.id, "DRIVE_CONNECTED");
        } else if (session.state === SessionState.DEGRADED_DRIVE) {
          this.registry.apply(session.id, "RECOVER_SUCCEEDED");
        }
      } catch {
        // Ignore invalid transitions.
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
          this.registry.apply(session.id, "DRIVE_DISCONNECTED");
        }
      } catch {
        // Ignore invalid transitions.
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
