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

type ErrorCode = "INVALID_ARGUMENT" | "NOT_IMPLEMENTED";

type ErrorEnvelope = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type ValidationError = {
  message: string;
  details?: Record<string, unknown>;
};

type Validator = (body: unknown) => ValidationError | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorEnvelope = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ErrorEnvelope => ({
  ok: false,
  error: {
    code,
    message,
    retryable: false,
    ...(details ? { details } : {}),
  },
});

const sendError = (
  res: ResponseLike,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): void => {
  const status = code === "INVALID_ARGUMENT" ? 400 : 501;
  res.status(status).json(errorEnvelope(code, message, details));
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
  return optionalEnum(obj, "consistency", ["best_effort", "quiesce"]);
};

const validateConsoleList: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  return validateSessionId(body as Record<string, unknown>);
};

const validateNetworkHar: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  return validateSessionId(body as Record<string, unknown>);
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
  return optionalString(obj, "expression", "expression");
};

const validatePerformanceMetrics: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  return validateSessionId(body as Record<string, unknown>);
};

const makeHandler = (action: string, validator: Validator) =>
  (req: RequestLike, res: ResponseLike): void => {
    const error = validator(req.body);
    if (error) {
      sendError(res, "INVALID_ARGUMENT", error.message, error.details);
      return;
    }

    sendError(res, "NOT_IMPLEMENTED", `${action} is not implemented yet.`, {
      action,
    });
  };

export const registerInspectRoutes = (router: RouteRegistry): void => {
  router.post(
    "/inspect/dom_snapshot",
    makeHandler("inspect.dom_snapshot", validateDomSnapshot)
  );
  router.post(
    "/inspect/console_list",
    makeHandler("inspect.console_list", validateConsoleList)
  );
  router.post(
    "/inspect/network_har",
    makeHandler("inspect.network_har", validateNetworkHar)
  );
  router.post(
    "/inspect/evaluate",
    makeHandler("inspect.evaluate", validateEvaluate)
  );
  router.post(
    "/inspect/performance_metrics",
    makeHandler("inspect.performance_metrics", validatePerformanceMetrics)
  );
};
