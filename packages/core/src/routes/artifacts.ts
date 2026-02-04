import { InspectError, InspectService, createInspectService } from "../inspect";
import type { ExtensionBridge } from "../extension-bridge";
import type { DriveTabInfo } from "../drive-protocol";
import type { TargetHint } from "../target-matching";
import type { SessionRegistry } from "../session";

type RequestLike = {
  body?: unknown;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

type RouteRegistry = {
  post: (path: string, handler: (req: RequestLike, res: ResponseLike) => void) => void;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code:
      | "INVALID_ARGUMENT"
      | "NOT_IMPLEMENTED"
      | "ARTIFACT_IO_ERROR"
      | "SESSION_NOT_FOUND"
      | "SESSION_CLOSED"
      | "INSPECT_UNAVAILABLE"
      | "EXTENSION_DISCONNECTED"
      | "DEBUGGER_IN_USE"
      | "ATTACH_DENIED"
      | "TAB_NOT_FOUND"
      | "NOT_SUPPORTED"
      | "TIMEOUT";
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type ArtifactsRoutesOptions = {
  registry?: SessionRegistry;
  inspectService?: InspectService;
  extensionBridge?: ExtensionBridge;
};

const sendError = (
  res: ResponseLike,
  status: number,
  code: ErrorEnvelope["error"]["code"],
  message: string,
  details?: Record<string, unknown>,
  retryable = false
): void => {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(details ? { details } : {}),
    },
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const deriveHintFromTabs = (tabs: DriveTabInfo[]): TargetHint | undefined => {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return undefined;
  }
  let best: DriveTabInfo | undefined;
  let bestTime = -Infinity;
  for (const tab of tabs) {
    const raw = tab.last_active_at;
    const time = raw ? Date.parse(raw) : NaN;
    const score = Number.isFinite(time) ? time : -Infinity;
    if (!best || score > bestTime) {
      best = tab;
      bestTime = score;
    }
  }
  if (!best) {
    return undefined;
  }
  if (!best.url && !best.title && !best.last_active_at) {
    return undefined;
  }
  return {
    url: best.url,
    title: best.title,
    lastActiveAt: best.last_active_at,
  };
};

const errorStatus = (code: ErrorEnvelope["error"]["code"]): number => {
  switch (code) {
    case "INVALID_ARGUMENT":
      return 400;
    case "SESSION_NOT_FOUND":
    case "TAB_NOT_FOUND":
      return 404;
    case "SESSION_CLOSED":
    case "DEBUGGER_IN_USE":
      return 409;
    case "ATTACH_DENIED":
      return 403;
    case "NOT_SUPPORTED":
      return 501;
    case "TIMEOUT":
      return 504;
    case "EXTENSION_DISCONNECTED":
    case "INSPECT_UNAVAILABLE":
      return 503;
    case "NOT_IMPLEMENTED":
      return 501;
    case "ARTIFACT_IO_ERROR":
    default:
      return 500;
  }
};

export const registerArtifactsRoutes = (
  router: RouteRegistry,
  options: ArtifactsRoutesOptions = {}
): void => {
  const inspect =
    options.inspectService ??
    (options.registry ? createInspectService({ registry: options.registry }) : undefined);

  router.post("/artifacts/screenshot", async (req, res) => {
    if (!isRecord(req.body)) {
      sendError(res, 400, "INVALID_ARGUMENT", "Request body must be an object.");
      return;
    }

    const sessionId = req.body.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      sendError(res, 400, "INVALID_ARGUMENT", "session_id is required.", {
        field: "session_id",
      });
      return;
    }

    const target = req.body.target;
    if (
      target !== undefined &&
      target !== "viewport" &&
      target !== "full"
    ) {
      sendError(res, 400, "INVALID_ARGUMENT", "target must be viewport or full.", {
        field: "target",
      });
      return;
    }

    try {
      if (!inspect) {
        sendError(
          res,
          501,
          "NOT_IMPLEMENTED",
          "artifacts.screenshot is not implemented yet."
        );
        return;
      }

      const hint = deriveHintFromTabs(options.extensionBridge?.getStatus().tabs ?? []);
      const result = await inspect.screenshot({
        sessionId,
        target: (target as "viewport" | "full") ?? "viewport",
        targetHint: hint,
      });
      res.status(200).json({ ok: true, result });
    } catch (error) {
      if (error instanceof InspectError) {
        sendError(
          res,
          errorStatus(error.code as ErrorEnvelope["error"]["code"]),
          error.code as ErrorEnvelope["error"]["code"],
          error.message,
          error.details,
          error.retryable
        );
        return;
      }
      sendError(res, 500, "ARTIFACT_IO_ERROR", "Failed to capture screenshot.");
    }
  });
};
