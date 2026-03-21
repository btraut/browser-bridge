import {
  PermissionsGetModeInputSchema,
  PermissionsListInputSchema,
  PermissionsListPendingRequestsInputSchema,
  PermissionsRequestAllowSiteInputSchema,
  PermissionsRequestRevokeSiteInputSchema,
  PermissionsRequestSetModeInputSchema,
} from '@btraut/browser-bridge-shared';
import { ExtensionBridge, ExtensionBridgeError } from '../extension-bridge';
import { ResponseLike, errorStatus, sendError, sendResult } from './shared';

type RequestLike = {
  body?: unknown;
};

type RouteRegistry = {
  post: (
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => void
  ) => void;
};

type SchemaLike<T> = {
  safeParse: (body: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { message: string; path: PropertyKey[] }[] };
      };
};

type PermissionsRouteOptions = {
  extensionBridge?: ExtensionBridge;
};

const EXTENSION_READY_WAIT_MS = 1500;

const parseBody = <T>(
  schema: SchemaLike<T>,
  body: unknown
): {
  data?: T;
  error?: { message: string; details?: Record<string, unknown> };
} => {
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

const sendBridgeUnavailable = (res: ResponseLike): void => {
  sendError(res, errorStatus('EXTENSION_DISCONNECTED'), {
    code: 'EXTENSION_DISCONNECTED',
    message: 'Extension bridge is unavailable.',
    retryable: true,
  });
};

const waitForExtensionReady = async (
  extensionBridge: ExtensionBridge
): Promise<boolean> => {
  if (extensionBridge.isConnected()) {
    return true;
  }
  const waitForReady = (
    extensionBridge as ExtensionBridge & {
      waitForReady?: (timeoutMs?: number) => Promise<boolean>;
    }
  ).waitForReady;
  if (typeof waitForReady !== 'function') {
    return extensionBridge.isConnected();
  }
  return await waitForReady.call(extensionBridge, EXTENSION_READY_WAIT_MS);
};

const makePermissionsHandler = <T>(
  schema: SchemaLike<T>,
  action:
    | 'permissions.list'
    | 'permissions.get_mode'
    | 'permissions.list_pending_requests'
    | 'permissions.request_allow_site'
    | 'permissions.request_revoke_site'
    | 'permissions.request_set_mode',
  options: PermissionsRouteOptions
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

    if (!options.extensionBridge) {
      sendBridgeUnavailable(res);
      return;
    }
    const extensionBridge = options.extensionBridge;

    void waitForExtensionReady(extensionBridge)
      .then(async (ready) => {
        if (!ready) {
          throw new ExtensionBridgeError(
            'EXTENSION_DISCONNECTED',
            'Extension is not connected.',
            true
          );
        }
        return await extensionBridge.request(
          action,
          parsed.data as Record<string, unknown>
        );
      })
      .then((envelope) => {
        if (envelope.status === 'error') {
          const error = envelope.error ?? {
            code: 'INTERNAL',
            message: 'Extension request failed.',
            retryable: false,
          };
          sendError(res, errorStatus(error.code), {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
          });
          return;
        }

        sendResult(res, envelope.result ?? {});
      })
      .catch((error) => {
        if (error instanceof ExtensionBridgeError) {
          sendError(res, errorStatus(error.code), {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
          });
          return;
        }

        sendError(res, errorStatus('INTERNAL'), {
          code: 'INTERNAL',
          message: 'Unexpected permissions route error.',
          retryable: false,
          details: {
            hint: error instanceof Error ? error.message : 'Unknown error.',
            action,
          },
        });
      });
  };
};

export const registerPermissionsRoutes = (
  router: RouteRegistry,
  options: PermissionsRouteOptions
): void => {
  router.post(
    '/permissions/list',
    makePermissionsHandler(
      PermissionsListInputSchema,
      'permissions.list',
      options
    )
  );
  router.post(
    '/permissions/get_mode',
    makePermissionsHandler(
      PermissionsGetModeInputSchema,
      'permissions.get_mode',
      options
    )
  );
  router.post(
    '/permissions/list_pending_requests',
    makePermissionsHandler(
      PermissionsListPendingRequestsInputSchema,
      'permissions.list_pending_requests',
      options
    )
  );
  router.post(
    '/permissions/request_allow_site',
    makePermissionsHandler(
      PermissionsRequestAllowSiteInputSchema,
      'permissions.request_allow_site',
      options
    )
  );
  router.post(
    '/permissions/request_revoke_site',
    makePermissionsHandler(
      PermissionsRequestRevokeSiteInputSchema,
      'permissions.request_revoke_site',
      options
    )
  );
  router.post(
    '/permissions/request_set_mode',
    makePermissionsHandler(
      PermissionsRequestSetModeInputSchema,
      'permissions.request_set_mode',
      options
    )
  );
};
