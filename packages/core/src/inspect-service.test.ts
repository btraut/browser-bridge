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

  it('truncates AX snapshots with maxNodes and keeps childIds consistent', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const axNodes = [
      { nodeId: '1', role: 'root', name: '', childIds: ['2', '3'] },
      { nodeId: '2', role: 'group', name: '', childIds: ['4'] },
      { nodeId: '3', role: 'button', name: 'Ok', childIds: [] },
      { nodeId: '4', role: 'text', name: 'Hidden', childIds: [] },
    ];

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Accessibility.getFullAXTree') {
          return { ok: true, result: { nodes: axNodes } };
        }
        if (method === 'Runtime.evaluate') {
          return { ok: true, result: { result: { value: '<html></html>' } } };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

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
              last_active_at: '2026-02-05T00:00:00Z',
            },
          ],
        }),
      },
      debuggerBridge,
    });

    const result = await service.domSnapshot({
      sessionId: session.id,
      format: 'ax',
      consistency: 'best_effort',
      maxNodes: 3,
    });

    expect(result.format).toBe('ax');
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain('AX snapshot truncated to 3 nodes.');

    const nodes = Array.isArray(result.snapshot)
      ? result.snapshot
      : (result.snapshot as { nodes?: unknown[] }).nodes;
    expect(Array.isArray(nodes)).toBe(true);
    const typedNodes = (nodes ?? []) as Array<{
      nodeId?: string;
      childIds?: string[];
    }>;
    expect(typedNodes.length).toBeLessThanOrEqual(3);

    const keptIds = new Set(
      typedNodes
        .map((node) => (typeof node.nodeId === 'string' ? node.nodeId : null))
        .filter((id): id is string => Boolean(id))
    );
    for (const node of typedNodes) {
      for (const childId of node.childIds ?? []) {
        expect(keptIds.has(childId)).toBe(true);
      }
    }
  });

  it('warns when maxNodes is provided for HTML snapshots', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Runtime.evaluate') {
          return { ok: true, result: { result: { value: '<html></html>' } } };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

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
              last_active_at: '2026-02-05T00:00:00Z',
            },
          ],
        }),
      },
      debuggerBridge,
    });

    const result = await service.domSnapshot({
      sessionId: session.id,
      format: 'html',
      consistency: 'best_effort',
      maxNodes: 10,
    });

    expect(result.format).toBe('html');
    expect(result.warnings).toContain(
      'max_nodes is only supported for AX snapshots.'
    );
  });
});
