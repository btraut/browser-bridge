import { InspectError, InspectService, createInspectService } from '../inspect';
import type { ExtensionBridge } from '../extension-bridge';
import type { SessionRegistry } from '../session';
import type { DebuggerBridge } from '../debugger-bridge';
import { ArtifactsScreenshotInputSchema } from '@btraut/browser-bridge-shared';
import {
  ResponseLike,
  deriveHintFromTabs,
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

type ErrorEnvelope = {
  ok: false;
  error: {
    code:
      | 'INVALID_ARGUMENT'
      | 'NOT_IMPLEMENTED'
      | 'ARTIFACT_IO_ERROR'
      | 'SESSION_NOT_FOUND'
      | 'SESSION_CLOSED'
      | 'INSPECT_UNAVAILABLE'
      | 'EXTENSION_DISCONNECTED'
      | 'DEBUGGER_IN_USE'
      | 'ATTACH_DENIED'
      | 'PERMISSION_REQUIRED'
      | 'TAB_NOT_FOUND'
      | 'NOT_SUPPORTED'
      | 'RATE_LIMITED'
      | 'TIMEOUT';
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type ArtifactsRoutesOptions = {
  registry?: SessionRegistry;
  inspectService?: InspectService;
  extensionBridge?: ExtensionBridge;
  debuggerBridge?: DebuggerBridge;
};

const sendArtifactsError = (
  res: ResponseLike,
  code: ErrorEnvelope['error']['code'],
  message: string,
  details?: Record<string, unknown>,
  retryable = false
): void => {
  sendError(res, errorStatus(code), {
    code,
    message,
    retryable,
    ...(details ? { details } : {}),
  });
};

export const registerArtifactsRoutes = (
  router: RouteRegistry,
  options: ArtifactsRoutesOptions = {}
): void => {
  const inspect =
    options.inspectService ??
    (options.registry
      ? createInspectService({
          registry: options.registry,
          extensionBridge: options.extensionBridge,
          debuggerBridge: options.debuggerBridge,
        })
      : undefined);

  router.post('/artifacts/screenshot', async (req, res) => {
    if (!isRecord(req.body)) {
      sendArtifactsError(
        res,
        'INVALID_ARGUMENT',
        'Request body must be an object.'
      );
      return;
    }

    const parsed = ArtifactsScreenshotInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      sendArtifactsError(
        res,
        'INVALID_ARGUMENT',
        issue?.message ?? 'Invalid screenshot request.',
        issue?.path.length
          ? {
              field: issue.path.map((part) => String(part)).join('.'),
            }
          : undefined
      );
      return;
    }

    const input = parsed.data;
    const target = input.fullPage ? 'full' : input.target;

    try {
      if (!inspect) {
        sendArtifactsError(
          res,
          'NOT_IMPLEMENTED',
          'artifacts.screenshot is not implemented yet.'
        );
        return;
      }

      const hint = deriveHintFromTabs(
        options.extensionBridge?.getStatus().tabs ?? []
      );
      const result = await inspect.screenshot({
        sessionId: input.session_id,
        target,
        selector: input.selector,
        format: input.format,
        quality: input.quality,
        targetHint: hint,
      });
      sendResult(res, result);
    } catch (error) {
      if (error instanceof InspectError) {
        sendArtifactsError(
          res,
          error.code as ErrorEnvelope['error']['code'],
          error.message,
          error.details,
          error.retryable
        );
        return;
      }
      sendArtifactsError(
        res,
        'ARTIFACT_IO_ERROR',
        'Failed to capture screenshot.'
      );
    }
  });
};
