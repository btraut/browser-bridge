import { DriveController } from '../drive';
import type { DriveAction } from '../drive-protocol';
import {
  DriveClickInputSchema,
  DriveNavigateInputSchema,
  DriveScrollInputSchema,
  DriveTabActivateInputSchema,
  DriveTabCloseInputSchema,
  DriveTabListInputSchema,
  DriveTypeInputSchema,
  DriveWaitForInputSchema,
} from '@browser-vision/shared';

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

type SchemaLike<T> = {
  safeParse: (
    body: unknown
  ) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { message: string; path: (string | number)[] }[] };
      };
};

type DriveRouteOptions = {
  drive: DriveController;
};

type HandlerOptions = {
  defaultResult?: unknown;
  timeoutFromParams?: (params: Record<string, unknown>) => number | undefined;
};

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

const parseBody = <T>(
  schema: SchemaLike<T>,
  body: unknown
): { data?: T; error?: ValidationError } => {
  const result = schema.safeParse(body);
  if (result.success) {
    return { data: result.data };
  }
  const issue = result.error.issues[0];
  const details =
    issue && issue.path.length > 0
      ? { field: issue.path.map((part) => part.toString()).join('.') }
      : undefined;
  return {
    error: {
      message: issue?.message ?? 'Request body is invalid.',
      ...(details ? { details } : {}),
    },
  };
};

const makeHandler = <T extends { session_id: string }>(
  action: DriveAction,
  schema: SchemaLike<T>,
  drive: DriveController,
  options: HandlerOptions = {}
) => {
  return (req: RequestLike, res: ResponseLike): void => {
    const parsed = parseBody(schema, req.body ?? {});
    if (parsed.error) {
      sendError(res, errorStatus('INVALID_ARGUMENT'), {
        code: 'INVALID_ARGUMENT',
        message: parsed.error.message,
        retryable: false,
        ...(parsed.error.details ? { details: parsed.error.details } : {}),
      });
      return;
    }

    const body = parsed.data as Record<string, unknown>;
    const sessionId = body.session_id as string;
    const params = { ...body };
    delete params.session_id;

    const timeoutMs = options.timeoutFromParams
      ? options.timeoutFromParams(params)
      : undefined;

    void drive
      .execute(sessionId, action, params, timeoutMs)
      .then((result) => {
        if (result.ok) {
          const payload =
            result.result === undefined
              ? options.defaultResult ?? { ok: true }
              : result.result;
          sendResult(res, payload);
          return;
        }
        sendError(res, errorStatus(result.error.code), result.error);
      })
      .catch((error) => {
        console.error('Drive execute failed:', error);
        sendError(res, errorStatus('INTERNAL'), {
          code: 'INTERNAL',
          message: 'Unexpected error while executing drive action.',
          retryable: false,
        });
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
    makeHandler('drive.navigate', DriveNavigateInputSchema, drive)
  );
  router.post(
    '/drive/click',
    makeHandler('drive.click', DriveClickInputSchema, drive)
  );
  router.post(
    '/drive/type',
    makeHandler('drive.type', DriveTypeInputSchema, drive)
  );
  router.post(
    '/drive/scroll',
    makeHandler('drive.scroll', DriveScrollInputSchema, drive)
  );
  router.post(
    '/drive/wait_for',
    makeHandler('drive.wait_for', DriveWaitForInputSchema, drive, {
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
    makeHandler('drive.tab_list', DriveTabListInputSchema, drive)
  );
  router.post(
    '/drive/tab_activate',
    makeHandler('drive.tab_activate', DriveTabActivateInputSchema, drive)
  );
  router.post(
    '/drive/tab_close',
    makeHandler('drive.tab_close', DriveTabCloseInputSchema, drive)
  );
};
