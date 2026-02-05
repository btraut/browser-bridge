import { describe, expect, it } from 'vitest';
import { InspectService } from './inspect';
import { SessionRegistry } from './session';
import type { DebuggerBridge } from './debugger-bridge';

describe('InspectService', () => {
  it('wraps debugger errors when no local errors are recorded', () => {
    const registry = new SessionRegistry();
    const debuggerBridge = {
      getLastError: () => ({
        error: {
          code: 'TAB_NOT_FOUND',
          message: 'No tab.',
          retryable: true,
        },
        at: '2025-01-01T00:00:00Z',
      }),
      hasAttachments: () => false,
    } as unknown as DebuggerBridge;

    const service = new InspectService({ registry, debuggerBridge });
    const lastError = service.getLastError();

    expect(lastError?.error.code).toBe('INSPECT_UNAVAILABLE');
    expect(lastError?.error.details?.code).toBe('TAB_NOT_FOUND');
  });

  it('throws INSPECT_UNAVAILABLE when debugger is missing', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.apply(session.id, 'DRIVE_CONNECTED');
    registry.apply(session.id, 'INSPECT_CONNECTED');

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({
          tabs: [
            {
              tab_id: 1,
              url: 'https://example.com',
              title: 'Example',
              window_id: 1,
              last_active_at: '2025-01-01T00:00:00Z',
            },
          ],
        }),
      },
    });

    await expect(
      service.consoleList({ sessionId: session.id })
    ).rejects.toMatchObject({ code: 'INSPECT_UNAVAILABLE' });
  });

  it('includes exception details + stack frames in console output', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({
          tabs: [
            {
              tab_id: 1,
              url: 'https://example.com',
              title: 'Example',
              window_id: 1,
              last_active_at: '2025-01-01T00:00:00Z',
            },
          ],
        }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: async () => ({ ok: true, result: {} }),
        getConsoleEvents: () => [
          {
            tab_id: 1,
            method: 'Runtime.exceptionThrown',
            timestamp: '2026-02-05T00:00:00.000Z',
            params: {
              exceptionDetails: {
                text: 'Uncaught',
                url: 'https://example.com/app.js',
                lineNumber: 0,
                columnNumber: 9,
                exception: {
                  type: 'object',
                  subtype: 'error',
                  description: 'TypeError: boom',
                },
                stackTrace: {
                  callFrames: [
                    {
                      functionName: 'explode',
                      url: 'https://example.com/app.js',
                      lineNumber: 0,
                      columnNumber: 9,
                    },
                  ],
                },
              },
            },
          },
        ],
      } as unknown as DebuggerBridge,
    });

    const result = await service.consoleList({ sessionId: session.id });
    expect(result.entries).toHaveLength(1);

    const entry = result.entries[0];
    expect(entry.level).toBe('error');
    expect(entry.text).toBe('Uncaught: TypeError: boom');
    expect(entry.exception?.description).toBe('TypeError: boom');
    expect(entry.source?.url).toBe('https://example.com/app.js');
    // 1-based output for human consumption.
    expect(entry.source?.line).toBe(1);
    expect(entry.source?.column).toBe(10);
    expect(entry.stack?.[0]).toMatchObject({
      functionName: 'explode',
      url: 'https://example.com/app.js',
      line: 1,
      column: 10,
    });
  });
});
