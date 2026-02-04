import { DriveController } from '../drive';
import type { DriveAction } from '../drive-protocol';

type RequestLike = {
  body?: unknown;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

type RouteRegistry = {
  post: (
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => void
  ) => void;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
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

type DriveRouteOptions = {
  drive: DriveController;
};

type HandlerOptions = {
  defaultResult?: unknown;
  timeoutFromParams?: (params: Record<string, unknown>) => number | undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sendError = (
  res: ResponseLike,
  status: number,
  error: ErrorEnvelope['error']
): void => {
  res.status(status).json({ ok: false, error });
};

const sendResult = <T>(res: ResponseLike, result: T): void => {
  const envelope: SuccessEnvelope<T> = { ok: true, result };
  res.status(200).json(envelope);
};

const errorStatus = (code: string): number => {
  switch (code) {
    case 'INVALID_ARGUMENT':
      return 400;
    case 'SESSION_NOT_FOUND':
    case 'LOCATOR_NOT_FOUND':
      return 404;
    case 'SESSION_CLOSED':
    case 'FAILED_PRECONDITION':
      return 409;
    case 'NOT_IMPLEMENTED':
      return 501;
    case 'EXTENSION_DISCONNECTED':
      return 503;
    case 'TIMEOUT':
      return 504;
    default:
      return 500;
  }
};

const requireObject = (body: unknown): ValidationError | null => {
  if (!isRecord(body)) {
    return { message: 'Request body must be an object.' };
  }
  return null;
};

const requireString = (
  obj: Record<string, unknown>,
  field: string,
  label = field
): ValidationError | null => {
  const value = obj[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
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
  if (typeof value !== 'number' || !Number.isFinite(value)) {
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
  if (typeof value !== 'boolean') {
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
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return {
      message: `${label} must be one of ${allowed
        .map((entry) => `'${entry}'`)
        .join(', ')}.`,
      details: { field },
    };
  }
  return null;
};

const validateSessionId = (
  obj: Record<string, unknown>
): ValidationError | null => requireString(obj, 'session_id');

const validateLocator = (value: unknown): ValidationError | null => {
  if (!isRecord(value)) {
    return {
      message: 'locator must be an object.',
      details: { field: 'locator' },
    };
  }

  let hasSelector = false;

  const testid = value.testid;
  if (testid !== undefined) {
    if (typeof testid !== 'string' || testid.trim().length === 0) {
      return {
        message: 'locator.testid must be a non-empty string.',
        details: { field: 'locator.testid' },
      };
    }
    hasSelector = true;
  }

  const css = value.css;
  if (css !== undefined) {
    if (typeof css !== 'string' || css.trim().length === 0) {
      return {
        message: 'locator.css must be a non-empty string.',
        details: { field: 'locator.css' },
      };
    }
    hasSelector = true;
  }

  const text = value.text;
  if (text !== undefined) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return {
        message: 'locator.text must be a non-empty string.',
        details: { field: 'locator.text' },
      };
    }
    hasSelector = true;
  }

  const role = value.role;
  if (role !== undefined) {
    if (!isRecord(role)) {
      return {
        message: 'locator.role must be an object.',
        details: { field: 'locator.role' },
      };
    }
    const roleName = role.name;
    if (typeof roleName !== 'string' || roleName.trim().length === 0) {
      return {
        message: 'locator.role.name must be a non-empty string.',
        details: { field: 'locator.role.name' },
      };
    }
    const roleValue = role.value;
    if (roleValue !== undefined && typeof roleValue !== 'string') {
      return {
        message: 'locator.role.value must be a string.',
        details: { field: 'locator.role.value' },
      };
    }
    hasSelector = true;
  }

  if (!hasSelector) {
    return {
      message: 'locator must include at least one selector.',
      details: { field: 'locator' },
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
  const urlError = requireString(obj, 'url');
  if (urlError) {
    return urlError;
  }
  const tabError = optionalNumber(obj, 'tab_id', 'tab_id');
  if (tabError) {
    return tabError;
  }
  return optionalEnum(obj, 'wait', ['none', 'domcontentloaded']);
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
  const tabError = optionalNumber(obj, 'tab_id', 'tab_id');
  if (tabError) {
    return tabError;
  }
  return optionalNumber(obj, 'click_count');
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
  const textError = requireString(obj, 'text');
  if (textError) {
    return textError;
  }
  const tabError = optionalNumber(obj, 'tab_id', 'tab_id');
  if (tabError) {
    return tabError;
  }
  const clearError = optionalBoolean(obj, 'clear');
  if (clearError) {
    return clearError;
  }
  return optionalBoolean(obj, 'submit');
};

const validateDriveScroll: Validator = (body) => {
  const objectError = requireObject(body);
  if (objectError) {
    return objectError;
  }
  const obj = body as Record<string, unknown>;
  const sessionError = validateSessionId(obj);
  if (sessionError) {
    return sessionError;
  }
  const deltaXError = optionalNumber(obj, 'delta_x', 'delta_x');
  if (deltaXError) {
    return deltaXError;
  }
  const deltaYError = optionalNumber(obj, 'delta_y', 'delta_y');
  if (deltaYError) {
    return deltaYError;
  }
  const topError = optionalNumber(obj, 'top', 'top');
  if (topError) {
    return topError;
  }
  const leftError = optionalNumber(obj, 'left', 'left');
  if (leftError) {
    return leftError;
  }
  const behaviorError = optionalEnum(obj, 'behavior', ['auto', 'smooth']);
  if (behaviorError) {
    return behaviorError;
  }
  if (
    obj.delta_x === undefined &&
    obj.delta_y === undefined &&
    obj.top === undefined &&
    obj.left === undefined
  ) {
    return {
      message: 'scroll requires delta_x/delta_y or top/left.',
      details: { field: 'scroll' },
    };
  }
  const tabError = optionalNumber(obj, 'tab_id', 'tab_id');
  if (tabError) {
    return tabError;
  }
  return null;
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
      message: 'condition must be an object.',
      details: { field: 'condition' },
    };
  }

  const kind = condition.kind;
  if (
    typeof kind !== 'string' ||
    !['locator_visible', 'text_present', 'url_matches'].includes(kind)
  ) {
    return {
      message:
        "condition.kind must be one of 'locator_visible', 'text_present', or 'url_matches'.",
      details: { field: 'condition.kind' },
    };
  }

  const value = condition.value;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      message: 'condition.value must be a non-empty string.',
      details: { field: 'condition.value' },
    };
  }

  const timeoutError = optionalNumber(obj, 'timeout_ms');
  if (timeoutError) {
    return timeoutError;
  }
  return optionalNumber(obj, 'tab_id', 'tab_id');
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
  const tabError = optionalNumber(obj, 'tab_id', 'tab_id');
  if (tabError) {
    return tabError;
  }
  if (obj.tab_id === undefined) {
    return {
      message: 'tab_id must be provided.',
      details: { field: 'tab_id' },
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
  const tabError = optionalNumber(obj, 'tab_id', 'tab_id');
  if (tabError) {
    return tabError;
  }
  if (obj.tab_id === undefined) {
    return {
      message: 'tab_id must be provided.',
      details: { field: 'tab_id' },
    };
  }
  return null;
};

const makeHandler = (
  action: DriveAction,
  validator: Validator,
  drive: DriveController,
  options: HandlerOptions = {}
) => {
  return (req: RequestLike, res: ResponseLike): void => {
    const error = validator(req.body);
    if (error) {
      sendError(res, errorStatus('INVALID_ARGUMENT'), {
        code: 'INVALID_ARGUMENT',
        message: error.message,
        retryable: false,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const sessionId = body.session_id as string;
    const params = { ...body };
    delete params.session_id;

    const timeoutMs = options.timeoutFromParams
      ? options.timeoutFromParams(params)
      : undefined;

    void drive.execute(sessionId, action, params, timeoutMs).then((result) => {
      if (result.ok) {
        const payload =
          result.result === undefined
            ? (options.defaultResult ?? { ok: true })
            : result.result;
        sendResult(res, payload);
        return;
      }
      sendError(res, errorStatus(result.error.code), result.error);
    });
  };
};

export const registerDriveRoutes = (
  router: RouteRegistry,
  options: DriveRouteOptions
): void => {
  const { drive } = options;

  router.post(
    '/drive/navigate',
    makeHandler('drive.navigate', validateDriveNavigate, drive)
  );
  router.post(
    '/drive/click',
    makeHandler('drive.click', validateDriveClick, drive)
  );
  router.post(
    '/drive/type',
    makeHandler('drive.type', validateDriveType, drive)
  );
  router.post(
    '/drive/scroll',
    makeHandler('drive.scroll', validateDriveScroll, drive)
  );
  router.post(
    '/drive/wait_for',
    makeHandler('drive.wait_for', validateDriveWaitFor, drive, {
      timeoutFromParams: (params) => {
        const timeout = params.timeout_ms;
        if (typeof timeout === 'number' && Number.isFinite(timeout)) {
          return Math.max(0, timeout + 1000);
        }
        return undefined;
      },
    })
  );
  router.post(
    '/drive/tab_list',
    makeHandler('drive.tab_list', validateDriveTabList, drive)
  );
  router.post(
    '/drive/tab_activate',
    makeHandler('drive.tab_activate', validateDriveTabActivate, drive)
  );
  router.post(
    '/drive/tab_close',
    makeHandler('drive.tab_close', validateDriveTabClose, drive)
  );
};
