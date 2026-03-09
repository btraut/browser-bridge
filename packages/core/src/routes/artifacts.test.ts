import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerArtifactsRoutes } from './artifacts';
import { createInspectService } from '../inspect';

vi.mock('../inspect', () => ({
  InspectError: class InspectError extends Error {
    code = 'INSPECT_UNAVAILABLE';
    retryable = false;
    details = undefined;
  },
  createInspectService: vi.fn(),
}));

type RegisteredHandler = (
  req: { body?: unknown },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    json: (body: unknown) => void;
  }
) => void | Promise<void>;

describe('registerArtifactsRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a fallback inspect service with extension and debugger bridges', async () => {
    const post = vi.fn();
    let handler: RegisteredHandler | undefined;
    post.mockImplementation((_path: string, registered: RegisteredHandler) => {
      handler = registered;
    });

    const screenshot = vi.fn(async () => ({
      artifact_id: 'artifact-1',
      path: '/tmp/screenshot.png',
      mime: 'image/png',
    }));
    vi.mocked(createInspectService).mockReturnValue({
      screenshot,
    } as never);

    const extensionBridge = {
      getStatus: () => ({
        tabs: [
          {
            tab_id: 7,
            url: 'https://example.com',
            title: 'Example',
            active: true,
            last_active_at: '2026-03-09T00:00:00.000Z',
          },
        ],
      }),
    };
    const debuggerBridge = { hasAttachments: () => false };
    const registry = {} as never;

    registerArtifactsRoutes(
      { post },
      {
        registry,
        extensionBridge: extensionBridge as never,
        debuggerBridge: debuggerBridge as never,
      }
    );

    expect(createInspectService).toHaveBeenCalledWith({
      registry,
      extensionBridge,
      debuggerBridge,
    });
    expect(handler).toBeTypeOf('function');

    const status = vi.fn((code: number) => ({ json: jsonStatus }));
    const jsonDirect = vi.fn();
    const jsonStatus = vi.fn();

    await handler?.(
      {
        body: {
          session_id: 'session-1',
          target: 'viewport',
        },
      },
      {
        status,
        json: jsonDirect,
      }
    );

    expect(screenshot).toHaveBeenCalledWith({
      sessionId: 'session-1',
      target: 'viewport',
      selector: undefined,
      format: 'png',
      quality: undefined,
      targetHint: {
        url: 'https://example.com',
        title: 'Example',
        lastActiveAt: '2026-03-09T00:00:00.000Z',
      },
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(jsonStatus).toHaveBeenCalledWith({
      ok: true,
      result: {
        artifact_id: 'artifact-1',
        path: '/tmp/screenshot.png',
        mime: 'image/png',
      },
    });
    expect(jsonDirect).not.toHaveBeenCalled();
  });
});
