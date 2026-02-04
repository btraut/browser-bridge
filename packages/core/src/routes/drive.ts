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

type DriveMutex = {
  runExclusive: <T>(work: () => T | Promise<T>) => Promise<T>;
};

export const driveMutex: DriveMutex = {
  async runExclusive<T>(work: () => T | Promise<T>): Promise<T> {
    return await work();
  },
};

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

const optionalNumber = (
  obj: Record<string, unknown>,
  field: string,
  label = field
): ValidationError | null => {
  const value = obj[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      message: `${label} must be a finite number.`,
      details: { field },
    };
  }
  return null;
};

const optionalBoolean = (
  obj: Record<string, unknown>,
  field: string,
  label = field
): ValidationError | null => {
  const value = obj[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "boolean") {
    return {
      message: `${label} must be a boolean.`,
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

const validateLocator = (value: unknown): ValidationError | null => {
  if (!isRecord(value)) {
    return {
      message: "locator must be an object.",
      details: { field: "locator" },
    };
  }

  let hasSelector = false;

  const testid = value.testid;
  if (testid !== undefined) {
    if (typeof testid !== "string" || testid.trim().length === 0) {
      return {
        message: "locator.testid must be a non-empty string.",
        details: { field: "locator.testid" },
      };
    }
    hasSelector = true;
  }

  const css = value.css;
  if (css !== undefined) {
    if (typeof css !== "string" || css.trim().length === 0) {
      return {
        message: "locator.css must be a non-empty string.",
        details: { field: "locator.css" },
      };
    }
    hasSelector = true;
  }

  const text = value.text;
  if (text !== undefined) {
    if (typeof text !== "string" || text.trim().length === 0) {
      return {
        message: "locator.text must be a non-empty string.",
        details: { field: "locator.text" },
      };
    }
    hasSelector = true;
  }

  const role = value.role;
  if (role !== undefined) {
    if (!isRecord(role)) {
      return {
        message: "locator.role must be an object.",
        details: { field: "locator.role" },
      };
    }
    const roleName = role.name;
    if (typeof roleName !== "string" || roleName.trim().length === 0) {
      return {
        message: "locator.role.name must be a non-empty string.",
        details: { field: "locator.role.name" },
      };
    }
    const roleValue = role.value;
    if (roleValue !== undefined && typeof roleValue !== "string") {
      return {
        message: "locator.role.value must be a string.",
        details: { field: "locator.role.value" },
      };
    }
    hasSelector = true;
  }

  if (!hasSelector) {
    return {
      message: "locator must include at least one selector.",
      details: { field: "locator" },
    };
  }

  return null;
};

const validateDriveNavigate: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const urlError = requireString(obj, "url");
  if (urlError) {
    return urlError;
  }
  return optionalEnum(obj, "wait", ["none", "domcontentloaded"]);
};

const validateDriveClick: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const locatorError = validateLocator(obj.locator);
  if (locatorError) {
    return locatorError;
  }
  return optionalNumber(obj, "click_count");
};

const validateDriveType: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const locatorValue = obj.locator;
  if (locatorValue !== undefined) {
    const locatorError = validateLocator(locatorValue);
    if (locatorError) {
      return locatorError;
    }
  }
  const textError = requireString(obj, "text");
  if (textError) {
    return textError;
  }
  const clearError = optionalBoolean(obj, "clear");
  if (clearError) {
    return clearError;
  }
  return optionalBoolean(obj, "submit");
};

const validateDriveWaitFor: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }

  const condition = obj.condition;
  if (!isRecord(condition)) {
    return {
      message: "condition must be an object.",
      details: { field: "condition" },
    };
  }

  const kind = condition.kind;
  if (
    typeof kind !== "string" ||
    !["locator_visible", "text_present", "url_matches"].includes(kind)
  ) {
    return {
      message:
        "condition.kind must be one of 'locator_visible', 'text_present', or 'url_matches'.",
      details: { field: "condition.kind" },
    };
  }

  const value = condition.value;
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      message: "condition.value must be a non-empty string.",
      details: { field: "condition.value" },
    };
  }

  return optionalNumber(obj, "timeout_ms");
};

const validateDriveTabList: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  return validateSessionId(body as Record<string, unknown>);
};

const validateDriveTabActivate: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const tabError = optionalNumber(obj, "tab_id", "tab_id");
  if (tabError) {
    return tabError;
  }
  if (obj.tab_id === undefined) {
    return {
      message: "tab_id must be provided.",
      details: { field: "tab_id" },
    };
  }
  return null;
};

const validateDriveTabClose: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const tabError = optionalNumber(obj, "tab_id", "tab_id");
  if (tabError) {
    return tabError;
  }
  if (obj.tab_id === undefined) {
    return {
      message: "tab_id must be provided.",
      details: { field: "tab_id" },
    };
  }
  return null;
};

const makeHandler = (action: string, validator: Validator) =>
  (req: RequestLike, res: ResponseLike): void => {
    const error = validator(req.body);
    if (error) {
      sendError(res, "INVALID_ARGUMENT", error.message, error.details);
      return;
    }

    void driveMutex.runExclusive(() => {
      sendError(res, "NOT_IMPLEMENTED", `${action} is not implemented yet.`, {
        action,
      });
    });
  };

export const registerDriveRoutes = (router: RouteRegistry): void => {
  router.post("/drive/navigate", makeHandler("drive.navigate", validateDriveNavigate));
  router.post("/drive/click", makeHandler("drive.click", validateDriveClick));
  router.post("/drive/type", makeHandler("drive.type", validateDriveType));
  router.post("/drive/wait_for", makeHandler("drive.wait_for", validateDriveWaitFor));
  router.post("/drive/tab_list", makeHandler("drive.tab_list", validateDriveTabList));
  router.post("/drive/tab_activate", makeHandler("drive.tab_activate", validateDriveTabActivate));
  router.post("/drive/tab_close", makeHandler("drive.tab_close", validateDriveTabClose));
};
