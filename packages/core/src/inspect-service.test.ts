import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InspectService } from './inspect';
import { SessionRegistry } from './session';
import type { DebuggerBridge } from './debugger-bridge';

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
                  forms: [{ id: 'form-1' }],
                  localStorage: [{ name: 'k', value: 'v' }],
                  sessionStorage: [],
                  cookies: [],
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
    expect(result.warnings).toContain('from-script');
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
