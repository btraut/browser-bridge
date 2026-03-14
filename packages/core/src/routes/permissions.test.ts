import { describe, expect, it, vi } from 'vitest';
import { ExtensionBridgeError } from '../extension-bridge';
import { registerPermissionsRoutes } from './permissions';
import type { ResponseLike } from './shared';

type RouteHandler = (req: { body?: unknown }, res: ResponseLike) => void;

const createRouteHarness = () => {
  const handlers = new Map<string, RouteHandler>();
  return {
    handlers,
    router: {
      post: (path: string, handler: RouteHandler) => {
        handlers.set(path, handler);
      },
    },
  };
};

const createResponse = () => {
  let statusCode = 0;
  let payload: unknown;
  const res: ResponseLike = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (body) => {
      payload = body;
    },
  };
  return {
    res,
    statusCode: () => statusCode,
    payload: () => payload,
  };
};

const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('registerPermissionsRoutes', () => {
  it('registers the canonical permissions routes', () => {
    const harness = createRouteHarness();
    registerPermissionsRoutes(harness.router, {});

    expect(harness.handlers.has('/permissions/list')).toBe(true);
    expect(harness.handlers.has('/permissions/get_mode')).toBe(true);
    expect(harness.handlers.has('/permissions/list_pending_requests')).toBe(
      true
    );
    expect(harness.handlers.has('/permissions/request_allow_site')).toBe(true);
    expect(harness.handlers.has('/permissions/request_revoke_site')).toBe(true);
    expect(harness.handlers.has('/permissions/request_set_mode')).toBe(true);
  });

  it('forwards validated requests to the extension bridge', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 'ok',
      result: {
        request_id: 'perm-1',
        kind: 'allow_site',
        status: 'approved',
        requested_at: '2026-03-13T00:00:00.000Z',
        site: 'example.com',
      },
    });
    const harness = createRouteHarness();
    registerPermissionsRoutes(harness.router, {
      extensionBridge: { request } as never,
    });

    const handler = harness.handlers.get('/permissions/request_allow_site');
    expect(handler).toBeDefined();

    const response = createResponse();
    handler?.(
      {
        body: {
          site: 'example.com',
          timeout_ms: 30000,
          source: 'cli',
        },
      },
      response.res
    );
    await flushAsync();

    expect(request).toHaveBeenCalledWith('permissions.request_allow_site', {
      site: 'example.com',
      timeout_ms: 30000,
      source: 'cli',
    });
    expect(response.statusCode()).toBe(200);
    expect(response.payload()).toEqual({
      ok: true,
      result: {
        request_id: 'perm-1',
        kind: 'allow_site',
        status: 'approved',
        requested_at: '2026-03-13T00:00:00.000Z',
        site: 'example.com',
      },
    });
  });

  it('returns validation errors before forwarding', async () => {
    const request = vi.fn();
    const harness = createRouteHarness();
    registerPermissionsRoutes(harness.router, {
      extensionBridge: { request } as never,
    });

    const handler = harness.handlers.get('/permissions/request_set_mode');
    expect(handler).toBeDefined();

    const response = createResponse();
    handler?.(
      {
        body: {
          mode: 'reckless',
        },
      },
      response.res
    );
    await flushAsync();

    expect(request).not.toHaveBeenCalled();
    expect(response.statusCode()).toBe(400);
    expect(response.payload()).toEqual({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'Invalid option: expected one of "granular"|"bypass"',
        retryable: false,
        details: {
          field: 'mode',
        },
      },
    });
  });

  it('maps extension bridge errors to route errors', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(
        new ExtensionBridgeError(
          'EXTENSION_DISCONNECTED',
          'Extension is not connected.',
          true
        )
      );
    const harness = createRouteHarness();
    registerPermissionsRoutes(harness.router, {
      extensionBridge: { request } as never,
    });

    const handler = harness.handlers.get('/permissions/list');
    expect(handler).toBeDefined();

    const response = createResponse();
    handler?.({ body: {} }, response.res);
    await flushAsync();

    expect(response.statusCode()).toBe(503);
    expect(response.payload()).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Extension is not connected.',
        retryable: true,
        details: {
          legacy_code: 'EXTENSION_DISCONNECTED',
          reason: 'extension_disconnected',
        },
      },
    });
  });
});
