import { DriveController } from '../drive';
import type { DriveAction } from '../drive-protocol';
import { SessionRegistry } from '../session';
import {
  DriveClickInputSchema,
  DriveGoBackInputSchema,
  DriveGoForwardInputSchema,
  DriveHoverInputSchema,
  DriveDragInputSchema,
  DialogAcceptInputSchema,
  DialogDismissInputSchema,
  DriveFillFormInputSchema,
  DriveHandleDialogInputSchema,
  DriveKeyInputSchema,
  DriveKeyPressInputSchema,
  DriveNavigateInputSchema,
  DriveScrollInputSchema,
  DriveSelectInputSchema,
  DriveTabActivateInputSchema,
  DriveTabCloseInputSchema,
  DriveTabListInputSchema,
  DriveTypeInputSchema,
  DriveWaitForInputSchema,
} from '@btraut/browser-bridge-shared';
import {
  ResponseLike,
  errorStatus,
  isRecord,
  sendError,
  sendResult,
} from './shared';

type RequestLike = {
  body?: unknown;
};

type RouteRegistry = {
  post: (
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => void
  ) => void;
};

type ValidationError = {
  message: string;
  details?: Record<string, unknown>;
};

type SchemaLike<T> = {
  safeParse: (body: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { message: string; path: PropertyKey[] }[] };
      };
};

type DriveRouteOptions = {
  drive: DriveController;
  registry: SessionRegistry;
};

type HandlerOptions = {
  defaultResult?: unknown;
  timeoutFromParams?: (params: Record<string, unknown>) => number | undefined;
};

const SUPPORTED_NAVIGATE_WAIT_MODES = [
  'none',
  'domcontentloaded',
  'networkidle',
] as const;

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

const makeNavigateHandler = <T extends { session_id?: string }>(
  schema: SchemaLike<T>,
  drive: DriveController,
  registry: SessionRegistry
) => {
  return (req: RequestLike, res: ResponseLike): void => {
    if (isRecord(req.body) && req.body.wait !== undefined) {
      const waitMode = req.body.wait;
      if (
        typeof waitMode !== 'string' ||
        !SUPPORTED_NAVIGATE_WAIT_MODES.includes(
          waitMode as (typeof SUPPORTED_NAVIGATE_WAIT_MODES)[number]
        )
      ) {
        sendError(res, errorStatus('INVALID_ARGUMENT'), {
          code: 'INVALID_ARGUMENT',
          message: `Unsupported wait mode: ${String(waitMode)}.`,
          retryable: false,
          details: {
            field: 'wait',
            supported_wait_modes: SUPPORTED_NAVIGATE_WAIT_MODES,
            mapped_wait_mode: 'domcontentloaded',
          },
        });
        return;
      }
    }

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
    const parsedSessionId = body.session_id;
    const sessionId =
      typeof parsedSessionId === 'string' && parsedSessionId.length > 0
        ? parsedSessionId
        : registry.create().id;

    const params = { ...body };
    delete params.session_id;

    void drive
      .execute<Record<string, unknown>>(
        sessionId,
        'drive.navigate',
        params as Record<string, unknown>
      )
      .then((result) => {
        if (result.ok) {
          const payload =
            result.result && typeof result.result === 'object'
              ? {
                  ...(result.result as Record<string, unknown>),
                  session_id: sessionId,
                }
              : {
                  ok: true,
                  session_id: sessionId,
                };
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
          details: {
            hint: error instanceof Error ? error.message : 'Unknown error.',
          },
        });
      });
  };
};

const makeHandler = <T extends { session_id?: string }>(
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
    const sessionId = body.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendError(res, errorStatus('INVALID_ARGUMENT'), {
        code: 'INVALID_ARGUMENT',
        message: 'session_id is required',
        retryable: false,
        details: {
          field: 'session_id',
        },
      });
      return;
    }
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
              ? (options.defaultResult ?? { ok: true })
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
          details: {
            hint: error instanceof Error ? error.message : 'Unknown error.',
          },
        });
      });
  };
};

const makeDialogHandler = <T extends { session_id: string }>(
  action: 'accept' | 'dismiss',
  schema: SchemaLike<T>,
  drive: DriveController,
  aliasName?: 'dialog.accept' | 'dialog.dismiss'
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

    const body = parsed.data as T;
    const { session_id: sessionId, ...rest } = body;
    const params = { ...rest, action };

    void drive
      .execute(sessionId, 'drive.handle_dialog', params)
      .then((result) => {
        if (result.ok) {
          const basePayload =
            result.result === undefined ? { ok: true } : result.result;
          if (
            !aliasName ||
            typeof basePayload !== 'object' ||
            basePayload === null
          ) {
            sendResult(res, basePayload);
            return;
          }
          const warning = `${aliasName} is deprecated; use drive.handle_dialog.`;
          const payload = basePayload as Record<string, unknown>;
          const warnings = Array.isArray(payload.warnings)
            ? payload.warnings.filter(
                (item): item is string => typeof item === 'string'
              )
            : [];
          sendResult(res, {
            ...payload,
            warnings: warnings.includes(warning)
              ? warnings
              : [...warnings, warning],
          });
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
          details: {
            hint: error instanceof Error ? error.message : 'Unknown error.',
          },
        });
      });
  };
};

export const registerDriveRoutes = (
  router: RouteRegistry,
  options: DriveRouteOptions
): void => {
  const { drive, registry } = options;

  router.post(
    '/drive/navigate',
    makeNavigateHandler(DriveNavigateInputSchema, drive, registry)
  );
  router.post(
    '/drive/go_back',
    makeHandler('drive.go_back', DriveGoBackInputSchema, drive)
  );
  router.post(
    '/drive/go_forward',
    makeHandler('drive.go_forward', DriveGoForwardInputSchema, drive)
  );
  router.post(
    '/drive/click',
    makeHandler('drive.click', DriveClickInputSchema, drive)
  );
  router.post(
    '/drive/hover',
    makeHandler('drive.hover', DriveHoverInputSchema, drive)
  );
  router.post(
    '/drive/select',
    makeHandler('drive.select', DriveSelectInputSchema, drive)
  );
  router.post(
    '/drive/type',
    makeHandler('drive.type', DriveTypeInputSchema, drive)
  );
  router.post(
    '/drive/fill_form',
    makeHandler('drive.fill_form', DriveFillFormInputSchema, drive)
  );
  router.post(
    '/drive/drag',
    makeHandler('drive.drag', DriveDragInputSchema, drive)
  );
  router.post(
    '/drive/handle_dialog',
    makeHandler('drive.handle_dialog', DriveHandleDialogInputSchema, drive)
  );
  router.post(
    '/dialog/accept',
    makeDialogHandler('accept', DialogAcceptInputSchema, drive, 'dialog.accept')
  );
  router.post(
    '/dialog/dismiss',
    makeDialogHandler(
      'dismiss',
      DialogDismissInputSchema,
      drive,
      'dialog.dismiss'
    )
  );
  router.post(
    '/drive/key',
    makeHandler('drive.key', DriveKeyInputSchema, drive)
  );
  router.post(
    '/drive/key_press',
    makeHandler('drive.key_press', DriveKeyPressInputSchema, drive)
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
