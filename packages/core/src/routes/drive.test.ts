import { describe, expect, it, vi } from 'vitest';
import type { DriveController } from '../drive';
import { SessionRegistry } from '../session';
import { registerDriveRoutes } from './drive';
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

describe('registerDriveRoutes', () => {
  it('registers only canonical history routes', () => {
    const registry = new SessionRegistry();
    const drive = { execute: vi.fn() } as unknown as DriveController;
    const harness = createRouteHarness();

    registerDriveRoutes(harness.router, { drive, registry });

    expect(harness.handlers.has('/drive/go_back')).toBe(true);
    expect(harness.handlers.has('/drive/go_forward')).toBe(true);
    expect(harness.handlers.has('/drive/back')).toBe(false);
    expect(harness.handlers.has('/drive/forward')).toBe(false);
  });

  it('auto-creates a session for drive.navigate when session_id is omitted', async () => {
    const registry = new SessionRegistry();
    const execute = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { ok: true } });
    const drive = { execute } as unknown as DriveController;

    const harness = createRouteHarness();
    registerDriveRoutes(harness.router, { drive, registry });

    const navigate = harness.handlers.get('/drive/navigate');
    expect(navigate).toBeDefined();

    const response = createResponse();
    navigate?.(
      {
        body: {
          url: 'https://example.com',
        },
      },
      response.res
    );
    await flushAsync();

    expect(execute).toHaveBeenCalledTimes(1);
    const [sessionId, action, params] = execute.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe('drive.navigate');
    expect(params).toEqual({
      url: 'https://example.com',
      wait: 'domcontentloaded',
    });
    expect(registry.get(sessionId)).toBeDefined();
    expect(response.statusCode()).toBe(200);
    expect(response.payload()).toEqual({
      ok: true,
      result: {
        ok: true,
        session_id: sessionId,
      },
    });
  });

  it('returns the provided session_id in drive.navigate response payload', async () => {
    const registry = new SessionRegistry();
    const existing = registry.create();
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      result: { ok: true, session_id: 'unexpected-session' },
    });
    const drive = { execute } as unknown as DriveController;

    const harness = createRouteHarness();
    registerDriveRoutes(harness.router, { drive, registry });

    const navigate = harness.handlers.get('/drive/navigate');
    expect(navigate).toBeDefined();

    const response = createResponse();
    navigate?.(
      {
        body: {
          session_id: existing.id,
          url: 'https://example.com',
          wait: 'none',
        },
      },
      response.res
    );
    await flushAsync();

    expect(execute).toHaveBeenCalledWith(existing.id, 'drive.navigate', {
      url: 'https://example.com',
      wait: 'none',
    });
    expect(response.statusCode()).toBe(200);
    expect(response.payload()).toEqual({
      ok: true,
      result: {
        ok: true,
        session_id: existing.id,
      },
    });
  });

  it('normalizes legacy error codes in route responses', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Session missing.',
        retryable: false,
      },
    });
    const drive = { execute } as unknown as DriveController;

    const harness = createRouteHarness();
    registerDriveRoutes(harness.router, { drive, registry });

    const goBack = harness.handlers.get('/drive/go_back');
    expect(goBack).toBeDefined();

    const response = createResponse();
    goBack?.(
      {
        body: {
          session_id: session.id,
        },
      },
      response.res
    );
    await flushAsync();

    expect(response.statusCode()).toBe(404);
    expect(response.payload()).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Session missing.',
        retryable: false,
        details: {
          legacy_code: 'SESSION_NOT_FOUND',
          reason: 'session_not_found',
          resource: 'session',
        },
      },
    });
  });

  it('maps dialog.accept alias to drive.handle_dialog with deprecation warning', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      result: { ok: true },
    });
    const drive = { execute } as unknown as DriveController;

    const harness = createRouteHarness();
    registerDriveRoutes(harness.router, { drive, registry });

    const accept = harness.handlers.get('/dialog/accept');
    expect(accept).toBeDefined();

    const response = createResponse();
    accept?.(
      {
        body: {
          session_id: session.id,
          promptText: 'ok',
        },
      },
      response.res
    );
    await flushAsync();

    expect(execute).toHaveBeenCalledWith(session.id, 'drive.handle_dialog', {
      promptText: 'ok',
      action: 'accept',
    });
    expect(response.statusCode()).toBe(200);
    expect(response.payload()).toEqual({
      ok: true,
      result: {
        ok: true,
        warnings: ['dialog.accept is deprecated; use drive.handle_dialog.'],
      },
    });
  });
});
