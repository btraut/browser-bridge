import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InspectService } from './inspect';
import { getAxNodes } from './inspect/ax-snapshot';
import { SessionRegistry } from './session';
import type { DebuggerBridge } from './debugger-bridge';
import type { DriveAction, DriveResponse } from './drive-protocol';

const DEFAULT_TAB = {
  tab_id: 1,
  url: 'https://example.com',
  title: 'Example',
  window_id: 1,
  last_active_at: '2026-02-05T00:00:00Z',
} as const;

const withTempArtifactsRoot = async <T>(
  fn: (tmpRoot: string) => Promise<T>
): Promise<T> => {
  const previous = process.env.TMPDIR;
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-bridge-test-'));
  process.env.TMPDIR = tmpRoot;
  try {
    return await fn(tmpRoot);
  } finally {
    process.env.TMPDIR = previous;
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

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

  it('clears last error after reconnect succeeds', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    let attachCall = 0;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge: {
        hasAttachments: () => false,
        getLastError: () => undefined,
        attach: async () => {
          attachCall += 1;
          if (attachCall === 1) {
            return {
              ok: false as const,
              error: {
                code: 'INSPECT_UNAVAILABLE',
                message: 'Attach failed.',
                retryable: false,
              },
            };
          }
          return { ok: true as const, result: { attached: true } };
        },
      } as unknown as DebuggerBridge,
    });

    const first = await service.reconnect(session.id);
    expect(first).toBe(false);
    expect(service.getLastError()).toBeDefined();

    const second = await service.reconnect(session.id);
    expect(second).toBe(true);
    expect(service.getLastError()).toBeUndefined();
  });

  it('includes exception details + stack frames in console output', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    session.createdAt = new Date('2026-02-04T00:00:00.000Z');

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

  it('keeps an expanded trigger and visible menu items in interactive AX snapshots', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const axNodes = [
      {
        nodeId: '1',
        backendDOMNodeId: 101,
        role: 'button',
        name: 'Account menu',
        childIds: [],
        properties: [{ name: 'expanded', value: { value: true } }],
      },
      {
        nodeId: '2',
        backendDOMNodeId: 102,
        role: 'menuitem',
        name: 'Profile',
        childIds: [],
      },
      {
        nodeId: '3',
        backendDOMNodeId: 103,
        role: 'menuitem',
        name: 'My decks',
        childIds: [],
      },
      {
        nodeId: '4',
        backendDOMNodeId: 104,
        role: 'text',
        name: 'Ignore me',
        childIds: [],
      },
    ];

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (
        _tabId: number,
        method: string,
        params?: Record<string, unknown>
      ) => {
        if (method === 'Accessibility.getFullAXTree') {
          return { ok: true, result: { nodes: axNodes } };
        }
        if (method === 'DOM.describeNode') {
          const backendNodeId = params?.backendNodeId;
          if (backendNodeId === 104) {
            return {
              ok: true,
              result: {
                node: {
                  nodeId: Number(backendNodeId),
                  nodeType: 3,
                },
              },
            };
          }
          return {
            ok: true,
            result: {
              node: {
                nodeId: Number(backendNodeId),
                nodeType: 1,
              },
            },
          };
        }
        if (
          method === 'Accessibility.enable' ||
          method === 'DOM.enable' ||
          method === 'Runtime.enable' ||
          method === 'DOM.setAttributeValue' ||
          method === 'Runtime.evaluate'
        ) {
          return { ok: true, result: {} };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({
          tabs: [DEFAULT_TAB],
        }),
      },
      debuggerBridge,
    });

    const result = await service.domSnapshot({
      sessionId: session.id,
      format: 'ax',
      consistency: 'best_effort',
      interactive: true,
    });

    const nodes = getAxNodes(result.snapshot);
    expect(nodes.map((node) => ({ role: node.role, name: node.name }))).toEqual(
      [
        { role: 'button', name: 'Account menu' },
        { role: 'menuitem', name: 'Profile' },
        { role: 'menuitem', name: 'My decks' },
      ]
    );
    expect(result.warnings?.some((warning) => warning.includes('Ref @e'))).toBe(
      false
    );
    expect(nodes.every((node) => typeof node.ref === 'string')).toBe(true);
  });

  it('prunes hover-hidden interactive controls from interactive AX snapshots', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const axNodes = [
      {
        nodeId: '1',
        backendDOMNodeId: 101,
        role: 'button',
        name: 'Increase maindeck count for Jace, the Mind Sculptor',
        childIds: [],
      },
      {
        nodeId: '2',
        backendDOMNodeId: 102,
        role: 'button',
        name: 'Edit maindeck quantity for Jace, the Mind Sculptor',
        childIds: [],
      },
    ];

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (
        _tabId: number,
        method: string,
        params?: Record<string, unknown>
      ) => {
        if (method === 'Accessibility.getFullAXTree') {
          return { ok: true, result: { nodes: axNodes } };
        }
        if (method === 'DOM.describeNode') {
          return {
            ok: true,
            result: {
              node: {
                nodeId: Number(params?.backendNodeId),
                nodeType: 1,
              },
            },
          };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params?.expression ?? '');
          if (
            expression.includes(
              'browser-bridge:collect-actionable-snapshot-refs'
            )
          ) {
            return {
              ok: true,
              result: {
                value: ['@e2'],
              },
            };
          }
          return { ok: true, result: {} };
        }
        if (
          method === 'Accessibility.enable' ||
          method === 'DOM.enable' ||
          method === 'Runtime.enable' ||
          method === 'DOM.setAttributeValue'
        ) {
          return { ok: true, result: {} };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({
          tabs: [DEFAULT_TAB],
        }),
      },
      debuggerBridge,
    });

    const result = await service.domSnapshot({
      sessionId: session.id,
      format: 'ax',
      consistency: 'best_effort',
      interactive: true,
    });

    const nodes = getAxNodes(result.snapshot);
    expect(nodes.map((node) => ({ role: node.role, name: node.name }))).toEqual(
      [
        {
          role: 'button',
          name: 'Edit maindeck quantity for Jace, the Mind Sculptor',
        },
      ]
    );
    expect(nodes.map((node) => node.ref)).toEqual(['@e2']);
  });

  it('does not leak stale root ref warnings through inspect.find', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const axNodes = [
      {
        nodeId: '1',
        backendDOMNodeId: 101,
        role: 'RootWebArea',
        name: 'ManaVault',
        childIds: ['2'],
      },
      {
        nodeId: '2',
        backendDOMNodeId: 102,
        role: 'button',
        name: 'Account menu',
        childIds: [],
      },
    ];

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (
        _tabId: number,
        method: string,
        params?: Record<string, unknown>
      ) => {
        if (method === 'Accessibility.getFullAXTree') {
          return { ok: true, result: { nodes: axNodes } };
        }
        if (method === 'DOM.describeNode' && params?.backendNodeId === 101) {
          throw Object.assign(new Error('Could not find node with given id'), {
            name: 'InspectError',
          });
        }
        if (method === 'DOM.describeNode' && params?.backendNodeId === 102) {
          return {
            ok: true,
            result: {
              node: {
                nodeId: 102,
                nodeType: 1,
              },
            },
          };
        }
        if (
          method === 'Accessibility.enable' ||
          method === 'DOM.enable' ||
          method === 'Runtime.enable' ||
          method === 'DOM.setAttributeValue' ||
          method === 'Runtime.evaluate'
        ) {
          return { ok: true, result: {} };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({
          tabs: [DEFAULT_TAB],
        }),
      },
      debuggerBridge,
    });

    const result = await service.find({
      sessionId: session.id,
      kind: 'role',
      role: 'button',
      name: 'Account menu',
    });

    expect(result.matches).toEqual([
      {
        ref: '@e2',
        role: 'button',
        name: 'Account menu',
      },
    ]);
    expect(result.warnings?.some((warning) => warning.includes('Ref @e'))).toBe(
      false
    );
  });

  it('writes a HAR artifact from buffered network events', async () => {
    await withTempArtifactsRoot(async () => {
      const registry = new SessionRegistry();
      const session = registry.create();

      const debuggerBridge = {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: async () => ({ ok: true, result: {} }),
        getNetworkEvents: () => [
          {
            tab_id: 1,
            method: 'Network.requestWillBeSent',
            timestamp: '2026-02-05T00:00:00.000Z',
            params: {
              requestId: '1',
              request: {
                url: 'https://example.com/api',
                method: 'GET',
                headers: { Accept: 'application/json' },
              },
            },
          },
          {
            tab_id: 1,
            method: 'Network.responseReceived',
            timestamp: '2026-02-05T00:00:00.100Z',
            params: {
              requestId: '1',
              response: {
                status: 200,
                statusText: 'OK',
                mimeType: 'application/json',
                headers: { 'Content-Type': 'application/json' },
                protocol: 'h2',
              },
            },
          },
          {
            tab_id: 1,
            method: 'Network.loadingFinished',
            timestamp: '2026-02-05T00:00:00.200Z',
            params: { requestId: '1', encodedDataLength: 123 },
          },
        ],
      } as unknown as DebuggerBridge;

      const service = new InspectService({
        registry,
        extensionBridge: {
          isConnected: () => true,
          getStatus: () => ({ tabs: [DEFAULT_TAB] }),
        },
        debuggerBridge,
      });

      const result = await service.networkHar({
        sessionId: session.id,
        targetHint: { url: DEFAULT_TAB.url },
      });

      expect(result.mime).toBe('application/json');
      expect(result.path).toContain(`/${session.id}/`);

      const raw = await readFile(result.path, 'utf-8');
      const parsed = JSON.parse(raw) as {
        log?: { entries?: Array<{ request?: { url?: string } }> };
      };
      expect(parsed.log?.entries?.[0]?.request?.url).toBe(
        'https://example.com/api'
      );
    });
  });

  it('maps artifact write failures to ARTIFACT_IO_ERROR for networkHar()', async () => {
    const previous = process.env.TMPDIR;
    const tmpFile = path.join(
      os.tmpdir(),
      `browser-bridge-test-${randomUUID()}`
    );
    await writeFile(tmpFile, 'not-a-directory', 'utf-8');
    process.env.TMPDIR = tmpFile;
    try {
      const registry = new SessionRegistry();
      const session = registry.create();

      const debuggerBridge = {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: async () => ({ ok: true, result: {} }),
        getNetworkEvents: () => [],
      } as unknown as DebuggerBridge;

      const service = new InspectService({
        registry,
        extensionBridge: {
          isConnected: () => true,
          getStatus: () => ({ tabs: [DEFAULT_TAB] }),
        },
        debuggerBridge,
      });

      await expect(
        service.networkHar({
          sessionId: session.id,
          targetHint: { url: DEFAULT_TAB.url },
        })
      ).rejects.toMatchObject({ code: 'ARTIFACT_IO_ERROR' });
    } finally {
      process.env.TMPDIR = previous;
      await rm(tmpFile, { force: true });
    }
  });

  it('captures a full-page screenshot and writes an artifact', async () => {
    await withTempArtifactsRoot(async () => {
      const registry = new SessionRegistry();
      const session = registry.create();

      const pngPayload = Buffer.from('fake-image-bytes').toString('base64');

      const debuggerBridge = {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: async (_tabId: number, method: string) => {
          if (method === 'Page.getLayoutMetrics') {
            return {
              ok: true,
              result: { contentSize: { width: 10, height: 20 } },
            };
          }
          if (method === 'Page.captureScreenshot') {
            return { ok: true, result: { data: pngPayload } };
          }
          return { ok: true, result: {} };
        },
      } as unknown as DebuggerBridge;

      const service = new InspectService({
        registry,
        extensionBridge: {
          isConnected: () => true,
          getStatus: () => ({ tabs: [DEFAULT_TAB] }),
        },
        debuggerBridge,
      });

      const result = await service.screenshot({
        sessionId: session.id,
        target: 'full',
        format: 'jpeg',
        quality: 80,
        targetHint: { url: DEFAULT_TAB.url },
      });

      expect(result.mime).toBe('image/jpeg');
      expect(result.path).toMatch(/\.jpg$/);

      const stats = await readFile(result.path);
      expect(stats.byteLength).toBeGreaterThan(0);
    });
  });

  it('captures a viewport screenshot through extension capture without debugger', async () => {
    await withTempArtifactsRoot(async () => {
      const registry = new SessionRegistry();
      const session = registry.create();

      const pngPayload = Buffer.from('viewport-image-bytes').toString('base64');
      const extensionRequestSpy = vi.fn();
      const extensionRequest = async <T = unknown>(
        action: DriveAction
      ): Promise<DriveResponse<T>> => {
        extensionRequestSpy(action);
        return {
          id: 'test-extension-request',
          action,
          status: 'ok',
          result: {
            data_base64: pngPayload,
          },
        } as DriveResponse<T>;
      };

      const service = new InspectService({
        registry,
        extensionBridge: {
          isConnected: () => true,
          getStatus: () => ({ tabs: [DEFAULT_TAB] }),
          request: extensionRequest,
        },
      });

      const result = await service.screenshot({
        sessionId: session.id,
        target: 'viewport',
        targetHint: { url: DEFAULT_TAB.url },
      });

      expect(extensionRequestSpy).toHaveBeenCalledTimes(1);
      expect(result.mime).toBe('image/png');
      expect((await readFile(result.path)).byteLength).toBeGreaterThan(0);
    });
  });

  it('falls back to CDP when extension full-page capture is rate-limited', async () => {
    await withTempArtifactsRoot(async () => {
      const registry = new SessionRegistry();
      const session = registry.create();

      const pngPayload = Buffer.from('fallback-image-bytes').toString('base64');

      const extensionRequestSpy = vi.fn();
      const extensionRequest = async <T = unknown>(
        action: DriveAction
      ): Promise<DriveResponse<T>> => {
        extensionRequestSpy(action);
        return {
          id: 'test-extension-request',
          action,
          status: 'error',
          error: {
            code: 'RATE_LIMITED',
            message: 'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND',
            retryable: true,
          },
        } as DriveResponse<T>;
      };

      const debuggerCommand = vi.fn(async (_tabId: number, method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return {
            ok: true as const,
            result: { contentSize: { width: 10, height: 20 } },
          };
        }
        if (method === 'Page.captureScreenshot') {
          return { ok: true as const, result: { data: pngPayload } };
        }
        return { ok: true as const, result: {} };
      });

      const debuggerBridge = {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: debuggerCommand,
      } as unknown as DebuggerBridge;

      const service = new InspectService({
        registry,
        extensionBridge: {
          isConnected: () => true,
          getStatus: () => ({ tabs: [DEFAULT_TAB] }),
          request: extensionRequest,
        },
        debuggerBridge,
      });

      const result = await service.screenshot({
        sessionId: session.id,
        target: 'full',
        format: 'png',
        targetHint: { url: DEFAULT_TAB.url },
      });

      expect(extensionRequestSpy).toHaveBeenCalledTimes(1);
      expect(
        debuggerCommand.mock.calls.some(
          (call) => call[1] === 'Page.captureScreenshot'
        )
      ).toBe(true);
      expect(result.mime).toBe('image/png');
      expect((await readFile(result.path)).byteLength).toBeGreaterThan(0);
    });
  });

  it('falls back to CDP when extension full-page capture is permission-gated', async () => {
    await withTempArtifactsRoot(async () => {
      const registry = new SessionRegistry();
      const session = registry.create();

      const pngPayload = Buffer.from('permission-fallback-bytes').toString(
        'base64'
      );

      const extensionRequestSpy = vi.fn();
      const extensionRequest = async <T = unknown>(
        action: DriveAction
      ): Promise<DriveResponse<T>> => {
        extensionRequestSpy(action);
        return {
          id: 'test-extension-request',
          action,
          status: 'error',
          error: {
            code: 'PERMISSION_REQUIRED',
            message:
              'Either the <all_urls> or activeTab permission is required.',
            retryable: false,
            details: {
              reason: 'capture_visible_tab_permission_required',
            },
          },
        } as DriveResponse<T>;
      };

      const debuggerCommand = vi.fn(async (_tabId: number, method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return {
            ok: true as const,
            result: { contentSize: { width: 10, height: 20 } },
          };
        }
        if (method === 'Page.captureScreenshot') {
          return { ok: true as const, result: { data: pngPayload } };
        }
        return { ok: true as const, result: {} };
      });

      const debuggerBridge = {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: debuggerCommand,
      } as unknown as DebuggerBridge;

      const service = new InspectService({
        registry,
        extensionBridge: {
          isConnected: () => true,
          getStatus: () => ({ tabs: [DEFAULT_TAB] }),
          request: extensionRequest,
        },
        debuggerBridge,
      });

      const result = await service.screenshot({
        sessionId: session.id,
        target: 'full',
        format: 'png',
        targetHint: { url: DEFAULT_TAB.url },
      });

      expect(extensionRequestSpy).toHaveBeenCalledTimes(1);
      expect(
        debuggerCommand.mock.calls.some(
          (call) => call[1] === 'Page.captureScreenshot'
        )
      ).toBe(true);
      expect(result.mime).toBe('image/png');
      expect((await readFile(result.path)).byteLength).toBeGreaterThan(0);
    });
  });

  it('preserves the extension screenshot error when debugger fallback is unavailable', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const extensionRequest = async <T = unknown>(
      action: DriveAction
    ): Promise<DriveResponse<T>> => ({
      id: 'test-extension-request',
      action,
      status: 'error',
      error: {
        code: 'PERMISSION_REQUIRED',
        message: 'Either the <all_urls> or activeTab permission is required.',
        retryable: false,
        details: {
          reason: 'capture_visible_tab_permission_required',
        },
      },
    });

    const debuggerBridge = {
      hasAttachments: () => false,
      getLastError: () => undefined,
      command: async () => ({
        ok: false as const,
        error: {
          code: 'ATTACH_DENIED',
          message: 'Debugger capability is disabled.',
          retryable: false,
        },
      }),
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
        request: extensionRequest,
      },
      debuggerBridge,
    });

    await expect(
      service.screenshot({
        sessionId: session.id,
        target: 'viewport',
        targetHint: { url: DEFAULT_TAB.url },
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
  });

  it('throws INSPECT_UNAVAILABLE when screenshot data is missing', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Page.captureScreenshot') {
          return { ok: true, result: {} };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    await expect(
      service.screenshot({
        sessionId: session.id,
        target: 'viewport',
        targetHint: { url: DEFAULT_TAB.url },
      })
    ).rejects.toMatchObject({ code: 'INSPECT_UNAVAILABLE' });
  });

  it('extracts markdown content via Readability', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const html = `<!doctype html><html><head><title>Example</title></head><body><article><h1>Hello</h1><p>World</p></article></body></html>`;

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Runtime.evaluate') {
          return { ok: true, result: { result: { value: html } } };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    const result = await service.extractContent({
      sessionId: session.id,
      format: 'markdown',
      includeMetadata: false,
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(result.content).toContain('World');
    expect('title' in result).toBe(false);
  });

  it('falls back to the semantic main region when Readability is too thin', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const html = `<!doctype html><html><head><title>Deck</title></head><body><article><h2>Add cards</h2><p>Enter adds to main. Shift Enter adds to sideboard.</p></article><main><h1>Untitled deck</h1><ul><li>12 Jace, the Mind Sculptor</li><li>4 Brainstorm</li><li>4 Force of Will</li><li>4 Ponder</li><li>24 Island</li></ul></main></body></html>`;

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Runtime.evaluate') {
          return { ok: true, result: { result: { value: html } } };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    const result = await service.extractContent({
      sessionId: session.id,
      format: 'markdown',
      includeMetadata: false,
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(result.content).toContain('Untitled deck');
    expect(result.content).toContain('12 Jace, the Mind Sculptor');
    expect(result.content).not.toContain('Enter adds to main');
  });

  it('collapses adjacent repeated markdown blocks from extracted content', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const html = `<!doctype html><html><head><title>Deck</title></head><body><article><section><h1>Untitled deck</h1><p>Planeswalkers (12)</p><p>Mana curve</p></section><section><h1>Untitled deck</h1><p>Planeswalkers (12)</p><p>Mana curve</p></section></article></body></html>`;

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Runtime.evaluate') {
          return { ok: true, result: { result: { value: html } } };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    const result = await service.extractContent({
      sessionId: session.id,
      format: 'markdown',
      includeMetadata: false,
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(result.content.match(/Untitled deck/g)).toHaveLength(1);
    expect(result.content).toContain('Planeswalkers (12)');
    expect(result.content).toContain('Mana curve');
  });

  it('waits for DOM quiescence before extracting content', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const html =
      '<!doctype html><html><body><main><h1>Hello</h1></main></body></html>';
    const command = vi.fn(
      async (
        _tabId: number,
        method: string,
        params?: { expression?: string }
      ) => {
        if (method === 'Runtime.evaluate') {
          if (
            typeof params?.expression === 'string' &&
            params.expression.includes('MutationObserver')
          ) {
            return { ok: true, result: { result: { value: true } } };
          }
          return { ok: true, result: { result: { value: html } } };
        }
        if (method === 'Page.getFrameTree') {
          return {
            ok: true,
            result: { frameTree: { frame: { id: 'frame-1' } } },
          };
        }
        if (method === 'Page.createIsolatedWorld') {
          return {
            ok: true,
            result: { executionContextId: 77 },
          };
        }
        return { ok: true, result: {} };
      }
    );

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command,
      } as unknown as DebuggerBridge,
    });

    await service.extractContent({
      sessionId: session.id,
      format: 'markdown',
      consistency: 'quiesce',
      includeMetadata: false,
      targetHint: { url: DEFAULT_TAB.url },
    });

    const runtimeExpressions = command.mock.calls
      .filter((call) => call[1] === 'Runtime.evaluate')
      .map((call) => call[2]?.expression);
    expect(
      runtimeExpressions.some(
        (expression) =>
          typeof expression === 'string' &&
          expression.includes('MutationObserver')
      )
    ).toBe(true);
  });

  it('throws EVALUATION_FAILED when extractContent() cannot parse the configured URL', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const tab = { ...DEFAULT_TAB, url: 'http://[invalid' };

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
        getStatus: () => ({ tabs: [tab] }),
      },
      debuggerBridge,
    });

    await expect(
      service.extractContent({
        sessionId: session.id,
        format: 'text',
        targetHint: { url: tab.url },
      })
    ).rejects.toMatchObject({ code: 'EVALUATION_FAILED' });
  });

  it('captures page state from an evaluation payload', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Runtime.evaluate') {
          return {
            ok: true,
            result: {
              result: {
                value: {
                  url: 'https://example.com',
                  title: 'Example',
                  readyState: 'complete',
                  forms: [{ selector: 'form[name="search"]', fields: [] }],
                  localStorage: [{ key: 'k', value: '[redacted]' }],
                  sessionStorage: [],
                  cookies: [],
                  storageSummary: {
                    localStorageCount: 1,
                    sessionStorageCount: 0,
                    cookieCount: 0,
                  },
                  warnings: ['from-script'],
                },
              },
            },
          };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    const result = await service.pageState({
      sessionId: session.id,
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(result.forms).toHaveLength(1);
    expect(result.localStorage).toHaveLength(1);
    expect(result.url).toBe('https://example.com');
    expect(result.storageSummary?.localStorageCount).toBe(1);
    expect(result.warnings).toContain('from-script');
  });

  it('builds page-state scripts with redacted values by default', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const command = vi.fn(
      async (
        _tabId: number,
        method: string,
        _params?: Record<string, unknown>
      ) => {
        void _params;
        if (method === 'Runtime.evaluate') {
          return {
            ok: true,
            result: {
              result: {
                value: {
                  url: 'https://example.com',
                  forms: [],
                  localStorage: [],
                  sessionStorage: [],
                  cookies: [],
                  storageSummary: {
                    localStorageCount: 0,
                    sessionStorageCount: 0,
                    cookieCount: 0,
                  },
                },
              },
            },
          };
        }
        return { ok: true, result: {} };
      }
    );

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command,
      } as unknown as DebuggerBridge,
    });

    await service.pageState({
      sessionId: session.id,
      targetHint: { url: DEFAULT_TAB.url },
    });

    const expression = command.mock.calls.find(
      (call) => call[1] === 'Runtime.evaluate'
    )?.[2]?.expression;
    expect(expression).toContain('const includeValues = false;');
  });

  it('evaluates extractContent in an isolated world when the top frame is available', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const html =
      '<!doctype html><html><body><main><h1>Hello</h1></main></body></html>';

    const command = vi.fn(
      async (
        _tabId: number,
        method: string,
        _params?: Record<string, unknown>
      ) => {
        void _params;
        if (method === 'Page.getFrameTree') {
          return {
            ok: true,
            result: { frameTree: { frame: { id: 'frame-1' } } },
          };
        }
        if (method === 'Page.createIsolatedWorld') {
          return {
            ok: true,
            result: { executionContextId: 77 },
          };
        }
        if (method === 'Runtime.evaluate') {
          return {
            ok: true,
            result: { result: { value: html } },
          };
        }
        return { ok: true, result: {} };
      }
    );

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command,
      } as unknown as DebuggerBridge,
    });

    await service.extractContent({
      sessionId: session.id,
      format: 'markdown',
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(
      command.mock.calls.some(
        (call) =>
          call[0] === DEFAULT_TAB.tab_id &&
          call[1] === 'Page.createIsolatedWorld' &&
          call[2]?.frameId === 'frame-1' &&
          call[2]?.worldName === 'browser_bridge_inspect'
      )
    ).toBe(true);
    expect(
      command.mock.calls.some(
        (call) =>
          call[0] === DEFAULT_TAB.tab_id &&
          call[1] === 'Runtime.evaluate' &&
          call[2]?.contextId === 77
      )
    ).toBe(true);
  });

  it('defaults inspect calls to the session-selected tab instead of active-tab heuristics', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const desiredTab = {
      ...DEFAULT_TAB,
      tab_id: 42,
      url: 'https://manavault.gg/',
      title: 'ManaVault',
      last_active_at: '2026-03-09T00:00:00Z',
    };
    const optionsTab = {
      ...DEFAULT_TAB,
      tab_id: 99,
      url: 'chrome-extension://ext/options.html',
      title: 'Browser Bridge - Site Permissions',
      last_active_at: '2026-03-09T00:01:00Z',
    };
    registry.setSelectedTab(session.id, desiredTab.tab_id);

    const command = vi.fn(async (tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          ok: true,
          result: {
            result: {
              value: {
                forms: [],
                localStorage: [],
                sessionStorage: [],
                cookies: [],
              },
            },
          },
        };
      }
      return { ok: true, result: {} };
    });

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [optionsTab, desiredTab] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command,
      } as unknown as DebuggerBridge,
    });

    await service.pageState({
      sessionId: session.id,
    });

    expect(
      command.mock.calls.some(
        (call) =>
          call[0] === desiredTab.tab_id && call[1] === 'Runtime.evaluate'
      )
    ).toBe(true);
  });

  it('filters console entries older than the session baseline', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    session.createdAt = new Date('2026-03-10T00:00:00.000Z');

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: async () => ({ ok: true, result: {} }),
        getConsoleEvents: () => [
          {
            tab_id: 1,
            method: 'Log.entryAdded',
            timestamp: '2026-03-09T23:59:59.000Z',
            params: {
              entry: {
                level: 'error',
                text: 'old',
              },
            },
          },
          {
            tab_id: 1,
            method: 'Log.entryAdded',
            timestamp: '2026-03-10T00:00:01.000Z',
            params: {
              entry: {
                level: 'error',
                text: 'fresh',
              },
            },
          },
        ],
      } as unknown as DebuggerBridge,
    });

    const result = await service.consoleList({
      sessionId: session.id,
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(result.entries.map((entry) => entry.text)).toEqual(['fresh']);
  });

  it('uses explicit targetHint.tabId instead of the session-selected tab', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const desiredTab = {
      ...DEFAULT_TAB,
      tab_id: 42,
      url: 'https://manavault.gg/',
      title: 'ManaVault',
      last_active_at: '2026-03-09T00:00:00Z',
    };
    const optionsTab = {
      ...DEFAULT_TAB,
      tab_id: 99,
      url: 'chrome-extension://ext/options.html',
      title: 'Browser Bridge - Site Permissions',
      last_active_at: '2026-03-09T00:01:00Z',
    };
    registry.setSelectedTab(session.id, optionsTab.tab_id);

    const command = vi.fn(async (tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          ok: true,
          result: {
            result: {
              value: {
                forms: [],
                localStorage: [],
                sessionStorage: [],
                cookies: [],
              },
            },
          },
        };
      }
      return { ok: true, result: {} };
    });

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [optionsTab, desiredTab] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command,
      } as unknown as DebuggerBridge,
    });

    await service.pageState({
      sessionId: session.id,
      targetHint: { tabId: desiredTab.tab_id },
    });

    expect(
      command.mock.calls.some(
        (call) =>
          call[0] === desiredTab.tab_id && call[1] === 'Runtime.evaluate'
      )
    ).toBe(true);
  });

  it('throws TAB_NOT_FOUND instead of drifting when the session-selected tab is gone', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.setSelectedTab(session.id, 42);

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge: {
        hasAttachments: () => true,
        getLastError: () => undefined,
        command: vi.fn(async () => ({ ok: true, result: {} })),
      } as unknown as DebuggerBridge,
    });

    await expect(
      service.pageState({
        sessionId: session.id,
      })
    ).rejects.toMatchObject({
      code: 'TAB_NOT_FOUND',
      details: { tab_id: 42 },
    });
  });

  it('throws EVALUATION_FAILED when the pageState script throws', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Runtime.evaluate') {
          return { ok: true, result: { exceptionDetails: {} } };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    await expect(
      service.pageState({
        sessionId: session.id,
        targetHint: { url: DEFAULT_TAB.url },
      })
    ).rejects.toMatchObject({ code: 'EVALUATION_FAILED' });
  });

  it('returns performance metrics and preserves selection warnings when present', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Performance.getMetrics') {
          return {
            ok: true,
            result: { metrics: [{ name: 'TaskDuration', value: 1.23 }] },
          };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    const result = await service.performanceMetrics({
      sessionId: session.id,
      targetHint: { url: DEFAULT_TAB.url },
    });

    expect(result.metrics).toEqual([{ name: 'TaskDuration', value: 1.23 }]);
  });

  it('maps debugger bridge errors for performanceMetrics()', async () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    const debuggerBridge = {
      hasAttachments: () => true,
      getLastError: () => undefined,
      command: async (_tabId: number, method: string) => {
        if (method === 'Performance.getMetrics') {
          return {
            ok: false,
            error: {
              code: 'TIMEOUT',
              message: 'Timed out.',
              retryable: true,
            },
          };
        }
        return { ok: true, result: {} };
      },
    } as unknown as DebuggerBridge;

    const service = new InspectService({
      registry,
      extensionBridge: {
        isConnected: () => true,
        getStatus: () => ({ tabs: [DEFAULT_TAB] }),
      },
      debuggerBridge,
    });

    await expect(
      service.performanceMetrics({
        sessionId: session.id,
        targetHint: { url: DEFAULT_TAB.url },
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
