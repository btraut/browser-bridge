export type DriveConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'backoff';

export type DriveConnectionEndpoint = {
  host: string;
  port: number;
  portSource: 'default' | 'storage';
};

export type DriveConnectionStatus = {
  state: DriveConnectionState;
  endpoint?: DriveConnectionEndpoint;
  ws_url?: string;
  reconnect_delay_ms?: number;
  retry_at?: string;
  last_connected_at?: string;
  last_disconnected_at?: string;
  last_error_at?: string;
  last_error_message?: string;
  consecutive_failures: number;
};

const toIso = (ms: number): string => new Date(ms).toISOString();

export class ConnectionStateTracker {
  private state: DriveConnectionState = 'disconnected';
  private endpoint?: DriveConnectionEndpoint;
  private reconnectDelayMs?: number;
  private retryAt?: string;
  private lastConnectedAt?: string;
  private lastDisconnectedAt?: string;
  private lastErrorAt?: string;
  private lastErrorMessage?: string;
  private consecutiveFailures = 0;
  private lastFailureLogAt = 0;
  private suppressedFailureLogs = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly failureLogThrottleMs = 15000
  ) {}

  setEndpoint(endpoint: DriveConnectionEndpoint): void {
    this.endpoint = endpoint;
  }

  markConnecting(): void {
    this.state = 'connecting';
    this.reconnectDelayMs = undefined;
    this.retryAt = undefined;
  }

  markConnected(): void {
    this.state = 'connected';
    this.lastConnectedAt = toIso(this.now());
    this.reconnectDelayMs = undefined;
    this.retryAt = undefined;
    this.consecutiveFailures = 0;
  }

  markDisconnected(): void {
    this.state = 'disconnected';
    this.reconnectDelayMs = undefined;
    this.retryAt = undefined;
    this.lastDisconnectedAt = toIso(this.now());
  }

  markBackoff(delayMs: number): void {
    this.state = 'backoff';
    this.reconnectDelayMs = delayMs;
    this.retryAt = toIso(this.now() + Math.max(0, delayMs));
  }

  recordFailure(message: string): void {
    this.lastErrorAt = toIso(this.now());
    this.lastErrorMessage = message;
    this.consecutiveFailures += 1;
  }

  consumeFailureLogBudget(): {
    shouldLog: boolean;
    suppressedCount: number;
  } {
    const now = this.now();
    if (
      this.lastFailureLogAt === 0 ||
      now - this.lastFailureLogAt >= this.failureLogThrottleMs
    ) {
      const suppressedCount = this.suppressedFailureLogs;
      this.suppressedFailureLogs = 0;
      this.lastFailureLogAt = now;
      return { shouldLog: true, suppressedCount };
    }

    this.suppressedFailureLogs += 1;
    return { shouldLog: false, suppressedCount: this.suppressedFailureLogs };
  }

  flushSuppressedFailureLogs(): number {
    const count = this.suppressedFailureLogs;
    this.suppressedFailureLogs = 0;
    return count;
  }

  getStatus(): DriveConnectionStatus {
    return {
      state: this.state,
      endpoint: this.endpoint,
      ws_url: this.endpoint
        ? `ws://${this.endpoint.host}:${this.endpoint.port}/drive`
        : undefined,
      reconnect_delay_ms: this.reconnectDelayMs,
      retry_at: this.retryAt,
      last_connected_at: this.lastConnectedAt,
      last_disconnected_at: this.lastDisconnectedAt,
      last_error_at: this.lastErrorAt,
      last_error_message: this.lastErrorMessage,
      consecutive_failures: this.consecutiveFailures,
    };
  }
}
