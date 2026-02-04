import { InspectError, InspectService, createInspectService } from '../inspect';
import type { ExtensionBridge } from '../extension-bridge';
import type { SessionRegistry } from '../session';
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
      | 'TAB_NOT_FOUND'
      | 'NOT_SUPPORTED'
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
      ? createInspectService({ registry: options.registry })
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

    const sessionId = req.body.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendArtifactsError(res, 'INVALID_ARGUMENT', 'session_id is required.', {
        field: 'session_id',
      });
      return;
    }

    const target = req.body.target;
    if (target !== undefined && target !== 'viewport' && target !== 'full') {
      sendArtifactsError(
        res,
        'INVALID_ARGUMENT',
        'target must be viewport or full.',
        {
          field: 'target',
        }
      );
      return;
    }

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
        sessionId,
        target: (target as 'viewport' | 'full') ?? 'viewport',
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
