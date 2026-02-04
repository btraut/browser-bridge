import { SessionError, SessionRegistry, SessionRecord } from "./session";
import { TargetHint } from "./target-matching";
import type { DebuggerBridge } from "./debugger-bridge";

export type InspectErrorCode =
  | "INVALID_ARGUMENT"
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "INSPECT_UNAVAILABLE"
  | "EVALUATION_FAILED"
  | "ARTIFACT_IO_ERROR"
  | "INTERNAL";

export class InspectError extends Error {
  public readonly code: InspectErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: InspectErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "InspectError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export type DomSnapshotResult = {
  format: "ax" | "html";
  snapshot: unknown;
  warnings?: string[];
};

export type ConsoleEntry = {
  level?: string;
  text?: string;
  timestamp?: string;
};

export type ConsoleListResult = {
  entries: ConsoleEntry[];
  warnings?: string[];
};

export type EvaluateResult = {
  value?: unknown;
  exception?: unknown;
  warnings?: string[];
};

export type PerformanceMetricsResult = {
  metrics: Array<{ name: string; value: number }>;
  warnings?: string[];
};

export type ArtifactInfo = {
  artifact_id: string;
  path: string;
  mime: string;
};

export type InspectServiceOptions = {
  registry: SessionRegistry;
  debuggerBridge?: DebuggerBridge;
};

export class InspectService {
  private readonly registry: SessionRegistry;
  private readonly debugger?: DebuggerBridge;
  private lastError?: InspectError;
  private lastErrorAt?: string;

  constructor(options: InspectServiceOptions) {
    this.registry = options.registry;
    this.debugger = options.debuggerBridge;
  }

  isConnected(): boolean {
    return this.debugger?.hasAttachments() ?? false;
  }

  getLastError():
    | { error: InspectError; at: string }
    | undefined {
    if (!this.lastError || !this.lastErrorAt) {
      const debuggerError = this.debugger?.getLastError();
      if (!debuggerError) {
        return undefined;
      }
      return {
        error: new InspectError("INSPECT_UNAVAILABLE", debuggerError.error.message, {
          retryable: debuggerError.error.retryable,
          details: {
            code: debuggerError.error.code,
            ...(debuggerError.error.details ? debuggerError.error.details : {}),
          },
        }),
        at: debuggerError.at,
      };
    }
    return { error: this.lastError, at: this.lastErrorAt };
  }

  async reconnect(sessionId: string): Promise<boolean> {
    try {
      this.requireSession(sessionId);
    } catch {
      return false;
    }

    const error = this.buildUnavailableError();
    this.recordError(error);
    return false;
  }

  async domSnapshot(_input: {
    sessionId: string;
    format: "ax" | "html";
    consistency: "best_effort" | "quiesce";
    targetHint?: TargetHint;
  }): Promise<DomSnapshotResult> {
    this.requireSession(_input.sessionId);
    this.throwUnavailable();
  }

  async consoleList(_input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<ConsoleListResult> {
    this.requireSession(_input.sessionId);
    this.throwUnavailable();
  }

  async networkHar(_input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<ArtifactInfo> {
    this.requireSession(_input.sessionId);
    this.throwUnavailable();
  }

  async evaluate(_input: {
    sessionId: string;
    expression?: string;
    targetHint?: TargetHint;
  }): Promise<EvaluateResult> {
    this.requireSession(_input.sessionId);
    this.throwUnavailable();
  }

  async performanceMetrics(_input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<PerformanceMetricsResult> {
    this.requireSession(_input.sessionId);
    this.throwUnavailable();
  }

  private recordError(error: InspectError): void {
    this.lastError = error;
    this.lastErrorAt = new Date().toISOString();
  }

  private buildUnavailableError(): InspectError {
    return new InspectError(
      "INSPECT_UNAVAILABLE",
      "Inspect is not available until the debugger bridge is configured.",
      { retryable: false }
    );
  }

  private throwUnavailable(): never {
    const error = this.buildUnavailableError();
    this.recordError(error);
    throw error;
  }

  private requireSession(sessionId: string): SessionRecord {
    try {
      return this.registry.require(sessionId);
    } catch (error) {
      if (error instanceof SessionError) {
        const code = error.code === "SESSION_CLOSED" ? "SESSION_CLOSED" : "SESSION_NOT_FOUND";
        const wrapped = new InspectError(code, error.message);
        this.recordError(wrapped);
        throw wrapped;
      }
      const wrapped = new InspectError("INTERNAL", "Failed to load session.");
      this.recordError(wrapped);
      throw wrapped;
    }
  }
}

export const createInspectService = (options: InspectServiceOptions): InspectService =>
  new InspectService(options);
