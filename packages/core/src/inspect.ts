import { randomUUID } from "crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureArtifactRootDir } from "./artifacts";
import { CdpError, CdpManager, ConsoleEntry, TargetSelection } from "./cdp";
import { SessionError, SessionRegistry, SessionRecord } from "./session";
import { InvalidSessionTransition, shouldRetryInspectOp } from "./state";
import { TargetHint } from "./target-matching";

export type InspectErrorCode =
  | "INVALID_ARGUMENT"
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "INSPECT_UNAVAILABLE"
  | "CDP_DISCONNECTED"
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
  cdpManager?: CdpManager;
};

export class InspectService {
  private readonly registry: SessionRegistry;
  private readonly cdp: CdpManager;
  private lastSessionId?: string;
  private lastError?: InspectError;
  private lastErrorAt?: string;

  constructor(options: InspectServiceOptions) {
    this.registry = options.registry;
    this.cdp = options.cdpManager ?? new CdpManager();

    this.cdp.on("disconnected", () => {
      if (!this.lastSessionId) {
        return;
      }
      try {
        this.registry.apply(this.lastSessionId, "INSPECT_DISCONNECTED");
      } catch {
        // Ignore state transition errors on disconnect.
      }
    });
  }

  isConnected(): boolean {
    return this.cdp.isConnected();
  }

  getLastError():
    | { error: InspectError; at: string }
    | undefined {
    if (!this.lastError || !this.lastErrorAt) {
      return undefined;
    }
    return { error: this.lastError, at: this.lastErrorAt };
  }

  async reconnect(sessionId: string): Promise<boolean> {
    try {
      const session = this.requireSession(sessionId);
      await this.cdp.ensureBrowser(session.mode);
      this.markInspectConnected(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  private recordError(error: InspectError): void {
    this.lastError = error;
    this.lastErrorAt = new Date().toISOString();
  }

  private async withRetry<T>(
    sessionId: string,
    work: () => Promise<T>
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof InspectError)) {
          const wrapped = new InspectError(
            "INTERNAL",
            "Unexpected inspect error."
          );
          this.recordError(wrapped);
          throw wrapped;
        }

        this.recordError(error);

        if (error.code === "CDP_DISCONNECTED") {
          const reconnectSucceeded = await this.reconnect(sessionId);
          if (shouldRetryInspectOp({ attempt, reconnectSucceeded })) {
            attempt += 1;
            continue;
          }
        }

        throw error;
      }
    }
  }

  async domSnapshot(input: {
    sessionId: string;
    format: "ax" | "html";
    consistency: "best_effort" | "quiesce";
    targetHint?: TargetHint;
  }): Promise<DomSnapshotResult> {
    return await this.withRetry(input.sessionId, async () => {
      const selection = await this.prepareTarget(input.sessionId, input.targetHint);
      await this.ensureQuiescent(selection.page, input.consistency);

      if (input.format === "html") {
        const html = await selection.page.content();
        return {
          format: "html",
          snapshot: html,
          warnings: selection.warnings,
        };
      }

      try {
        const session = await selection.page.createCDPSession();
        try {
          const result = await session.send("Accessibility.getFullAXTree");
          return {
            format: "ax",
            snapshot: result,
            warnings: selection.warnings,
          };
        } finally {
          await session.detach();
        }
      } catch {
        const html = await selection.page.content();
        return {
          format: "html",
          snapshot: html,
          warnings: [
            ...(selection.warnings ?? []),
            "AX snapshot failed; returned HTML instead.",
          ],
        };
      }
    });
  }

  async consoleList(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<ConsoleListResult> {
    return await this.withRetry(input.sessionId, async () => {
      const selection = await this.prepareTarget(input.sessionId, input.targetHint);
      await this.cdp.ensureConsoleCapture(selection.target, selection.page);
      return {
        entries: this.cdp.getConsoleEntries(selection.target),
        warnings: selection.warnings,
      };
    });
  }

  async networkHar(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<ArtifactInfo> {
    return await this.withRetry(input.sessionId, async () => {
      const selection = await this.prepareTarget(input.sessionId, input.targetHint);

      const performance = await selection.page.evaluate(() => {
        const global = globalThis as unknown as {
          performance: {
            timeOrigin: number;
            getEntriesByType: (type: string) => Array<Record<string, unknown>>;
          };
          document: { title: string };
        };

        const perf = global.performance;
        return {
          title: global.document.title,
          timeOrigin: perf.timeOrigin,
          navigation: perf.getEntriesByType("navigation"),
          resources: perf.getEntriesByType("resource"),
        };
      });

      const entries = Array.isArray(performance.resources)
        ? performance.resources
        : [];

      const navEntry = Array.isArray(performance.navigation)
        ? performance.navigation[0]
        : undefined;

      const har = {
        log: {
          version: "1.2",
          creator: {
            name: "browser-vision",
            version: "0.0.0",
          },
          pages: [
            {
              id: "page_0",
              title: performance.title,
              startedDateTime: new Date(performance.timeOrigin).toISOString(),
              pageTimings: {
                onContentLoad: navEntry?.domContentLoadedEventEnd ?? -1,
                onLoad: navEntry?.loadEventEnd ?? -1,
              },
            },
          ],
          entries: entries.map((entry) => {
            const startTime = Number(entry.startTime ?? 0);
            const duration = Number(entry.duration ?? 0);
            const requestUrl = String(entry.name ?? "");
            const startedDateTime = new Date(
              performance.timeOrigin + startTime
            ).toISOString();

            const transferSize = Number(entry.transferSize ?? 0);

            return {
              pageref: "page_0",
              startedDateTime,
              time: duration,
              request: {
                method: "GET",
                url: requestUrl,
                httpVersion: "HTTP/1.1",
                cookies: [],
                headers: [],
                queryString: [],
                headersSize: -1,
                bodySize: -1,
              },
              response: {
                status: 0,
                statusText: "",
                httpVersion: "HTTP/1.1",
                cookies: [],
                headers: [],
                redirectURL: "",
                headersSize: -1,
                bodySize: transferSize,
                content: {
                  size: transferSize,
                  mimeType: String(entry.initiatorType ?? ""),
                },
              },
              cache: {},
              timings: {
                send: 0,
                wait: duration,
                receive: 0,
              },
            };
          }),
        },
      };

      try {
        const rootDir = await ensureArtifactRootDir(input.sessionId);
        const artifactId = randomUUID();
        const filePath = path.join(rootDir, `har-${artifactId}.json`);
        await writeFile(filePath, JSON.stringify(har, null, 2), "utf-8");
        return {
          artifact_id: artifactId,
          path: filePath,
          mime: "application/json",
        };
      } catch {
        throw new InspectError("ARTIFACT_IO_ERROR", "Failed to write HAR file.");
      }
    });
  }

  async evaluate(input: {
    sessionId: string;
    expression?: string;
    targetHint?: TargetHint;
  }): Promise<EvaluateResult> {
    return await this.withRetry(input.sessionId, async () => {
      const selection = await this.prepareTarget(input.sessionId, input.targetHint);
      const expression = input.expression ?? "undefined";

      try {
        const session = await selection.page.createCDPSession();
        try {
          const result = await session.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });

          if (result.exceptionDetails) {
            return {
              exception: result.exceptionDetails,
              warnings: selection.warnings,
            };
          }

          return {
            value: result.result?.value,
            warnings: selection.warnings,
          };
        } finally {
          await session.detach();
        }
      } catch {
        throw new InspectError("EVALUATION_FAILED", "Failed to evaluate expression.");
      }
    });
  }

  async performanceMetrics(input: {
    sessionId: string;
    targetHint?: TargetHint;
  }): Promise<PerformanceMetricsResult> {
    return await this.withRetry(input.sessionId, async () => {
      const selection = await this.prepareTarget(input.sessionId, input.targetHint);

      const session = await selection.page.createCDPSession();
      try {
        const result = await session.send("Performance.getMetrics");
        const metrics = Array.isArray(result.metrics)
          ? result.metrics.map((metric: { name: string; value: number }) => ({
              name: metric.name,
              value: metric.value,
            }))
          : [];

        return {
          metrics,
          warnings: selection.warnings,
        };
      } finally {
        await session.detach();
      }
    });
  }

  private async prepareTarget(
    sessionId: string,
    targetHint?: TargetHint
  ): Promise<TargetSelection> {
    this.lastSessionId = sessionId;
    const session = this.requireSession(sessionId);

    try {
      await this.cdp.ensureBrowser(session.mode);
    } catch (error) {
      if (error instanceof CdpError) {
        throw new InspectError(
          error.code === "CDP_DISCONNECTED"
            ? "CDP_DISCONNECTED"
            : "INSPECT_UNAVAILABLE",
          error.message,
          { retryable: error.code === "CDP_DISCONNECTED" }
        );
      }
      throw new InspectError("INSPECT_UNAVAILABLE", "Failed to connect to CDP.");
    }

    try {
      const selection = await this.cdp.selectTarget(targetHint);
      await this.cdp.ensureConsoleCapture(selection.target, selection.page);
      this.markInspectConnected(sessionId);
      return selection;
    } catch (error) {
      if (error instanceof CdpError) {
        throw new InspectError("INSPECT_UNAVAILABLE", error.message);
      }
      throw new InspectError("INSPECT_UNAVAILABLE", "Failed to select target.");
    }
  }

  private requireSession(sessionId: string): SessionRecord {
    try {
      return this.registry.require(sessionId);
    } catch (error) {
      if (error instanceof SessionError) {
        const code = error.code === "SESSION_CLOSED" ? "SESSION_CLOSED" : "SESSION_NOT_FOUND";
        throw new InspectError(code, error.message);
      }
      throw new InspectError("INTERNAL", "Failed to load session.");
    }
  }

  private markInspectConnected(sessionId: string): void {
    try {
      this.registry.apply(sessionId, "INSPECT_CONNECTED");
    } catch (error) {
      if (error instanceof InvalidSessionTransition) {
        return;
      }
    }
  }

  private async ensureQuiescent(
    page: { waitForNetworkIdle: (options: { idleTime?: number; timeout?: number }) => Promise<void> },
    consistency: "best_effort" | "quiesce"
  ): Promise<void> {
    if (consistency !== "quiesce") {
      return;
    }

    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 });
    } catch {
      // Best effort: ignore idle timeout.
    }
  }
}

export const createInspectService = (options: InspectServiceOptions): InspectService =>
  new InspectService(options);
