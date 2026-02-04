import { InspectError, InspectService, createInspectService } from '../inspect';
import { TargetHint } from '../target-matching';
import { SessionRegistry } from '../session';
import type { ExtensionBridge } from '../extension-bridge';
import type { DriveTabInfo } from '../drive-protocol';
import {
  InspectConsoleListInputSchema,
  InspectDomSnapshotInputSchema,
  InspectEvaluateInputSchema,
  InspectNetworkHarInputSchema,
  InspectPerformanceMetricsInputSchema,
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

type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_IMPLEMENTED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'INSPECT_UNAVAILABLE'
  | 'EXTENSION_DISCONNECTED'
  | 'DEBUGGER_IN_USE'
  | 'ATTACH_DENIED'
  | 'TAB_NOT_FOUND'
  | 'NOT_SUPPORTED'
  | 'TIMEOUT'
  | 'EVALUATION_FAILED'
  | 'ARTIFACT_IO_ERROR'
  | 'INTERNAL';

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

type InspectRoutesOptions = {
  registry: SessionRegistry;
  inspectService?: InspectService;
  extensionBridge?: ExtensionBridge;
};

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
      case 'INVALID_ARGUMENT':
        return 400;
      case 'SESSION_NOT_FOUND':
        return 404;
      case 'TAB_NOT_FOUND':
        return 404;
      case 'SESSION_CLOSED':
        return 409;
      case 'DEBUGGER_IN_USE':
        return 409;
      case 'ATTACH_DENIED':
        return 403;
      case 'EXTENSION_DISCONNECTED':
        return 503;
      case 'NOT_SUPPORTED':
        return 501;
      case 'TIMEOUT':
        return 504;
      case 'INSPECT_UNAVAILABLE':
        return 503;
      case 'EVALUATION_FAILED':
      case 'ARTIFACT_IO_ERROR':
      case 'INTERNAL':
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

type TargetHintInput = {
  url?: string;
  title?: string;
  last_active_at?: string;
  lastActiveAt?: string;
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

const readTargetHint = (target?: TargetHintInput): TargetHint | undefined => {
  if (!target) {
    return undefined;
  }
  const url = typeof target.url === 'string' ? target.url : undefined;
  const title = typeof target.title === 'string' ? target.title : undefined;
  const lastActiveAtRaw = target.last_active_at ?? target.lastActiveAt;
  const lastActiveAt =
    typeof lastActiveAtRaw === 'string' ? lastActiveAtRaw : undefined;
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
  target: TargetHintInput | undefined,
  options: InspectRoutesOptions
): TargetHint | undefined => {
  const explicit = readTargetHint(target);
  if (explicit) {
    return explicit;
  }
  const tabs = options.extensionBridge?.getStatus().tabs ?? [];
  return deriveHintFromTabs(tabs);
};

const makeHandler = <TBody extends { session_id: string }, TResult>(
  schema: SchemaLike<TBody>,
  handler: (body: TBody) => Promise<TResult>
) =>
  async (req: RequestLike, res: ResponseLike): Promise<void> => {
    const parsed = parseBody(schema, req.body ?? {});
    if (parsed.error) {
      sendError(
        res,
        'INVALID_ARGUMENT',
        parsed.error.message,
        false,
        parsed.error.details
      );
      return;
    }

    try {
      const result = await handler(parsed.data as TBody);
      sendResult(res, result);
    } catch (err) {
      if (err instanceof InspectError) {
        sendError(res, err.code, err.message, err.retryable, err.details);
        return;
      }
      sendError(res, 'INTERNAL', 'Unexpected inspect error.', false);
    }
  };

export const registerInspectRoutes = (
  router: RouteRegistry,
  options: InspectRoutesOptions
): void => {
  const inspect =
    options.inspectService ??
    createInspectService({
      registry: options.registry,
      extensionBridge: options.extensionBridge,
    });

  router.post(
    '/inspect/dom_snapshot',
    makeHandler(InspectDomSnapshotInputSchema, async (body) => {
      return await inspect.domSnapshot({
        sessionId: body.session_id,
        format: body.format,
        consistency: body.consistency,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
  router.post(
    '/inspect/console_list',
    makeHandler(InspectConsoleListInputSchema, async (body) => {
      return await inspect.consoleList({
        sessionId: body.session_id,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
  router.post(
    '/inspect/network_har',
    makeHandler(InspectNetworkHarInputSchema, async (body) => {
      return await inspect.networkHar({
        sessionId: body.session_id,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
  router.post(
    '/inspect/evaluate',
    makeHandler(InspectEvaluateInputSchema, async (body) => {
      return await inspect.evaluate({
        sessionId: body.session_id,
        expression: body.expression,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
  router.post(
    '/inspect/performance_metrics',
    makeHandler(InspectPerformanceMetricsInputSchema, async (body) => {
      return await inspect.performanceMetrics({
        sessionId: body.session_id,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
};
