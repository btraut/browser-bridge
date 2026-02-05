import { InspectError, InspectService, createInspectService } from '../inspect';
import { TargetHint } from '../target-matching';
import { SessionRegistry } from '../session';
import type { ExtensionBridge } from '../extension-bridge';
import {
  InspectConsoleListInputSchema,
  InspectDomDiffInputSchema,
  InspectDomSnapshotInputSchema,
  InspectEvaluateInputSchema,
  InspectFindInputSchema,
  InspectExtractContentInputSchema,
  InspectNetworkHarInputSchema,
  InspectPageStateInputSchema,
  InspectPerformanceMetricsInputSchema,
} from '@browser-vision/shared';
import {
  ResponseLike,
  deriveHintFromTabs,
  errorStatus,
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
        error: { issues: { message: string; path: PropertyKey[] }[] };
      };
};

type InspectRoutesOptions = {
  registry: SessionRegistry;
  inspectService?: InspectService;
  extensionBridge?: ExtensionBridge;
};

const sendInspectError = (
  res: ResponseLike,
  code: ErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>
): void => {
  sendError(res, errorStatus(code), {
    code,
    message,
    retryable,
    ...(details ? { details } : {}),
  });
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
      sendInspectError(
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
        sendInspectError(res, err.code, err.message, err.retryable, err.details);
        return;
      }
      sendInspectError(res, 'INTERNAL', 'Unexpected inspect error.', false);
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
        interactive: body.interactive,
        compact: body.compact,
        selector: body.selector,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
  router.post(
    '/inspect/dom_diff',
    makeHandler(InspectDomDiffInputSchema, async (body) => {
      return inspect.domDiff({ sessionId: body.session_id });
    })
  );
  router.post(
    '/inspect/find',
    makeHandler(InspectFindInputSchema, async (body) => {
      const targetHint = resolveTargetHint(body.target, options);
      if (body.kind === 'role') {
        return await inspect.find({
          sessionId: body.session_id,
          kind: 'role',
          role: body.role,
          name: body.name,
          targetHint,
        });
      }
      if (body.kind === 'text') {
        return await inspect.find({
          sessionId: body.session_id,
          kind: 'text',
          text: body.text,
          targetHint,
        });
      }
      return await inspect.find({
        sessionId: body.session_id,
        kind: 'label',
        label: body.label,
        targetHint,
      });
    })
  );
  router.post(
    '/inspect/extract_content',
    makeHandler(InspectExtractContentInputSchema, async (body) => {
      return await inspect.extractContent({
        sessionId: body.session_id,
        format: body.format,
        includeMetadata: body.include_metadata,
        targetHint: resolveTargetHint(body.target, options),
      });
    })
  );
  router.post(
    '/inspect/page_state',
    makeHandler(InspectPageStateInputSchema, async (body) => {
      return await inspect.pageState({
        sessionId: body.session_id,
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
