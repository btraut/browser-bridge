import { describe, expect, it, vi } from 'vitest';
import { registerInspectRoutes } from './inspect';
import type { InspectService } from '../inspect';
import { SessionRegistry } from '../session';
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

describe('registerInspectRoutes', () => {
  it('does not invent a target hint when the caller omits target', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.setSelectedTab(session.id, 77);
    const pageState = vi.fn(async () => ({ forms: [], localStorage: [] }));
    const inspect = { pageState } as unknown as InspectService;
    const harness = createRouteHarness();

    registerInspectRoutes(harness.router, {
      registry,
      inspectService: inspect,
      extensionBridge: {
        getStatus: () => ({
          tabs: [
            {
              tab_id: 99,
              window_id: 1,
              url: 'chrome-extension://ext/options.html',
              title: 'Browser Bridge - Site Permissions',
              active: true,
              last_active_at: '2026-03-09T00:01:00.000Z',
            },
          ],
        }),
      } as never,
    });

    const handler = harness.handlers.get('/inspect/page_state');
    expect(handler).toBeDefined();

    const response = createResponse();
    await handler?.(
      {
        body: {
          session_id: session.id,
        },
      },
      response.res
    );

    expect(pageState).toHaveBeenCalledTimes(1);
    const firstRequest = (
      pageState.mock.calls as unknown as Array<[unknown]>
    )[0]?.[0];
    expect(firstRequest).toEqual({
      sessionId: session.id,
      targetHint: undefined,
    });
    expect(response.statusCode()).toBe(200);
  });

  it('passes through explicit target.tab_id unchanged', async () => {
    const registry = new SessionRegistry();
    const pageState = vi.fn(async () => ({ forms: [], localStorage: [] }));
    const inspect = { pageState } as unknown as InspectService;
    const harness = createRouteHarness();

    registerInspectRoutes(harness.router, {
      registry,
      inspectService: inspect,
    });

    const handler = harness.handlers.get('/inspect/page_state');
    expect(handler).toBeDefined();

    const response = createResponse();
    await handler?.(
      {
        body: {
          session_id: 'session-1',
          target: {
            tab_id: 42,
          },
        },
      },
      response.res
    );

    expect(pageState).toHaveBeenCalledTimes(1);
    const firstRequest = (
      pageState.mock.calls as unknown as Array<[unknown]>
    )[0]?.[0];
    expect(firstRequest).toEqual({
      sessionId: 'session-1',
      targetHint: { tabId: 42 },
    });
    expect(response.payload()).toEqual({
      ok: true,
      result: {
        forms: [],
        localStorage: [],
      },
    });
  });
});
