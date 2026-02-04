import { InspectError, InspectService, createInspectService } from "../inspect";
import { TargetHint } from "../target-matching";
import { SessionRegistry } from "../session";
import type { ExtensionBridge } from "../extension-bridge";
import type { DriveTabInfo } from "../drive-protocol";

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

type ErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_IMPLEMENTED"
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "INSPECT_UNAVAILABLE"
  | "EVALUATION_FAILED"
  | "ARTIFACT_IO_ERROR"
  | "INTERNAL";

type ErrorEnvelope = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type SuccessEnvelope<T> = {
  ok: true;
  result: T;
};

type ValidationError = {
  message: string;
  details?: Record<string, unknown>;
};

type Validator = (body: unknown) => ValidationError | null;

type InspectRoutesOptions = {
  registry: SessionRegistry;
  inspectService?: InspectService;
  extensionBridge?: ExtensionBridge;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorEnvelope = (
  code: ErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>
): ErrorEnvelope => ({
  ok: false,
  error: {
    code,
    message,
    retryable,
    ...(details ? { details } : {}),
  },
});

const sendError = (
  res: ResponseLike,
  code: ErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>
): void => {
  const status = (() => {
    switch (code) {
      case "INVALID_ARGUMENT":
        return 400;
      case "SESSION_NOT_FOUND":
        return 404;
      case "SESSION_CLOSED":
        return 409;
      case "INSPECT_UNAVAILABLE":
        return 503;
      case "EVALUATION_FAILED":
      case "ARTIFACT_IO_ERROR":
      case "INTERNAL":
      default:
        return 500;
    }
  })();
  res.status(status).json(errorEnvelope(code, message, retryable, details));
};

const sendResult = <T>(res: ResponseLike, result: T): void => {
  const envelope: SuccessEnvelope<T> = { ok: true, result };
  res.status(200).json(envelope);
};

const requireObject = (body: unknown): ValidationError | null => {
  if (!isRecord(body)) {
    return { message: "Request body must be an object." };
  }
  return null;
};

const requireString = (
  obj: Record<string, unknown>,
  field: string,
  label = field
): ValidationError | null => {
  const value = obj[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      message: `${label} must be a non-empty string.`,
      details: { field },
    };
  }
  return null;
};

const optionalString = (
  obj: Record<string, unknown>,
  field: string,
  label = field
): ValidationError | null => {
  const value = obj[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      message: `${label} must be a non-empty string.`,
      details: { field },
    };
  }
  return null;
};

const optionalEnum = (
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  label = field
): ValidationError | null => {
  const value = obj[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    return {
      message: `${label} must be one of ${allowed
        .map((entry) => `'${entry}'`)
        .join(", ")}.`,
      details: { field },
    };
  }
  return null;
};

const optionalTargetHint = (obj: Record<string, unknown>): ValidationError | null => {
  const target = obj.target;
  if (target === undefined) {
    return null;
  }
  if (!isRecord(target)) {
    return {
      message: "target must be an object.",
      details: { field: "target" },
    };
  }
  const url = target.url;
  if (url !== undefined && (typeof url !== "string" || url.trim().length === 0)) {
    return {
      message: "target.url must be a non-empty string.",
      details: { field: "target.url" },
    };
  }
  const title = target.title;
  if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
    return {
      message: "target.title must be a non-empty string.",
      details: { field: "target.title" },
    };
  }
  const lastActiveAt = target.last_active_at ?? target.lastActiveAt;
  if (lastActiveAt !== undefined && typeof lastActiveAt !== "string") {
    return {
      message: "target.last_active_at must be a string.",
      details: { field: "target.last_active_at" },
    };
  }
  return null;
};

const readTargetHint = (obj: Record<string, unknown>): TargetHint | undefined => {
  const target = obj.target;
  if (!isRecord(target)) {
    return undefined;
  }
  const url = typeof target.url === "string" ? target.url : undefined;
  const title = typeof target.title === "string" ? target.title : undefined;
  const lastActiveAtRaw = target.last_active_at ?? target.lastActiveAt;
  const lastActiveAt = typeof lastActiveAtRaw === "string" ? lastActiveAtRaw : undefined;
  if (!url && !title && !lastActiveAt) {
    return undefined;
  }
  return { url, title, lastActiveAt };
};

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

const resolveTargetHint = (
  body: Record<string, unknown>,
  options: InspectRoutesOptions
): TargetHint | undefined => {
  const explicit = readTargetHint(body);
  if (explicit) {
    return explicit;
  }
  const tabs = options.extensionBridge?.getStatus().tabs ?? [];
  return deriveHintFromTabs(tabs);
};

const validateSessionId = (obj: Record<string, unknown>): ValidationError | null =>
  requireString(obj, "session_id");

const validateDomSnapshot: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const formatError = optionalEnum(obj, "format", ["ax", "html"]);
  if (formatError) {
    return formatError;
  }
  const consistencyError = optionalEnum(obj, "consistency", ["best_effort", "quiesce"]);
  if (consistencyError) {
    return consistencyError;
  }
  return optionalTargetHint(obj);
};

const validateConsoleList: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  return optionalTargetHint(obj);
};

const validateNetworkHar: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  return optionalTargetHint(obj);
};

const validateEvaluate: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const expressionError = optionalString(obj, "expression", "expression");
  if (expressionError) {
    return expressionError;
  }
  return optionalTargetHint(obj);
};

const validatePerformanceMetrics: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  return optionalTargetHint(obj);
};

const makeHandler = <T>(
  validator: Validator,
  handler: (body: Record<string, unknown>) => Promise<T>
) =>
  async (req: RequestLike, res: ResponseLike): Promise<void> => {
    const error = validator(req.body);
    if (error) {
      sendError(res, "INVALID_ARGUMENT", error.message, false, error.details);
      return;
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await handler(body);
      sendResult(res, result);
    } catch (err) {
      if (err instanceof InspectError) {
        sendError(res, err.code, err.message, err.retryable, err.details);
        return;
      }
      sendError(res, "INTERNAL", "Unexpected inspect error.", false);
    }
  };

export const registerInspectRoutes = (
  router: RouteRegistry,
  options: InspectRoutesOptions
): void => {
  const inspect =
    options.inspectService ?? createInspectService({ registry: options.registry });

  router.post(
    "/inspect/dom_snapshot",
    makeHandler(validateDomSnapshot, async (body) => {
      return await inspect.domSnapshot({
        sessionId: body.session_id as string,
        format: (body.format as "ax" | "html") ?? "ax",
        consistency: (body.consistency as "best_effort" | "quiesce") ?? "best_effort",
        targetHint: resolveTargetHint(body, options),
      });
    })
  );
  router.post(
    "/inspect/console_list",
    makeHandler(validateConsoleList, async (body) => {
      return await inspect.consoleList({
        sessionId: body.session_id as string,
        targetHint: resolveTargetHint(body, options),
      });
    })
  );
  router.post(
    "/inspect/network_har",
    makeHandler(validateNetworkHar, async (body) => {
      return await inspect.networkHar({
        sessionId: body.session_id as string,
        targetHint: resolveTargetHint(body, options),
      });
    })
  );
  router.post(
    "/inspect/evaluate",
    makeHandler(validateEvaluate, async (body) => {
      return await inspect.evaluate({
        sessionId: body.session_id as string,
        expression: body.expression as string | undefined,
        targetHint: resolveTargetHint(body, options),
      });
    })
  );
  router.post(
    "/inspect/performance_metrics",
    makeHandler(validatePerformanceMetrics, async (body) => {
      return await inspect.performanceMetrics({
        sessionId: body.session_id as string,
        targetHint: resolveTargetHint(body, options),
      });
    })
  );
};
