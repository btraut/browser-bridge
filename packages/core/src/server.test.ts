import { describe, expect, it } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import {
  HTTP_CONTRACT_VERSION,
  HTTP_CONTRACT_VERSION_HEADER,
  type ResolvedCoreRuntime,
} from '@btraut/browser-bridge-shared';
import {
  createCoreServer,
  buildRuntimeMetadataForPersist,
  resolveProbePortsForRuntime,
} from './server';

const createRuntime = (
  overrides: Partial<ResolvedCoreRuntime> = {}
): ResolvedCoreRuntime => ({
  host: '127.0.0.1',
  port: 4400,
  hostSource: 'default',
  portSource: 'default',
  metadataPath: '/tmp/runtime/dev.json',
  metadata: null,
  gitRoot: '/tmp/repo',
  worktreeId: 'wt-abc',
  deterministicPort: 4400,
  isolatedMode: false,
  isolatedModeSource: 'default',
  ...overrides,
});

describe('resolveProbePortsForRuntime', () => {
  it('uses a single configured port in default (non-isolated) mode', () => {
    const runtime = createRuntime({
      isolatedMode: false,
      portSource: 'deterministic',
      port: 4488,
    });

    expect(resolveProbePortsForRuntime(runtime)).toEqual([4488]);
  });

  it('probes bounded port range when isolated mode uses deterministic routing', () => {
    const runtime = createRuntime({
      isolatedMode: true,
      isolatedModeSource: 'metadata',
      portSource: 'deterministic',
      port: 4400,
    });

    expect(resolveProbePortsForRuntime(runtime)).toEqual([
      4400, 4401, 4402, 4403, 4404, 4405, 4406, 4407, 4408, 4409, 4410, 4411,
      4412, 4413, 4414, 4415, 4416, 4417, 4418, 4419,
    ]);
  });

  it('does not probe extra ports for explicit option/env ports in isolated mode', () => {
    const runtime = createRuntime({
      isolatedMode: true,
      isolatedModeSource: 'env',
      portSource: 'option',
      port: 5555,
    });

    expect(resolveProbePortsForRuntime(runtime)).toEqual([5555]);
  });
});

describe('buildRuntimeMetadataForPersist', () => {
  it('preserves extension and routing metadata while updating runtime values', () => {
    const runtime = createRuntime({
      host: '127.0.0.1',
      port: 3210,
      metadata: {
        extension_id: 'abcdefghijklmnopabcdefghijklmnop',
        isolated_mode: true,
        git_root: '/tmp/old-repo',
      },
      gitRoot: '/tmp/new-repo',
      worktreeId: 'wt-new',
    });

    const metadata = buildRuntimeMetadataForPersist(runtime, 3210);

    expect(metadata.extension_id).toBe('abcdefghijklmnopabcdefghijklmnop');
    expect(metadata.isolated_mode).toBe(true);
    expect(metadata.git_root).toBe('/tmp/new-repo');
    expect(metadata.worktree_id).toBe('wt-new');
    expect(metadata.host).toBe('127.0.0.1');
    expect(metadata.port).toBe(3210);
    expect(metadata.updated_at).toBeTypeOf('string');
  });
});

describe('core HTTP contract versioning', () => {
  it('exposes contract version header on health responses', async () => {
    const { app } = createCoreServer();
    const server = createHttpServer(app);

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected test server address.');
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get(HTTP_CONTRACT_VERSION_HEADER)).toBe(
        HTTP_CONTRACT_VERSION
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  });

  it('returns deterministic mismatch errors when client version header is incompatible', async () => {
    const { app } = createCoreServer();
    const server = createHttpServer(app);

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected test server address.');
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/health/check`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [HTTP_CONTRACT_VERSION_HEADER]: 'legacy-1',
          },
          body: JSON.stringify({}),
        }
      );
      const payload = (await response.json()) as {
        ok: boolean;
        error?: {
          code?: string;
          details?: Record<string, unknown>;
        };
      };

      expect(response.status).toBe(409);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('FAILED_PRECONDITION');
      expect(payload.error?.details).toEqual(
        expect.objectContaining({
          header: HTTP_CONTRACT_VERSION_HEADER,
          expected: HTTP_CONTRACT_VERSION,
          received: 'legacy-1',
        })
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  });

  it('supports canonical health POST routes with legacy alias compatibility', async () => {
    const { app } = createCoreServer();
    const server = createHttpServer(app);

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected test server address.');
    }

    try {
      const readiness = await fetch(`http://127.0.0.1:${address.port}/health`, {
        method: 'POST',
      });
      const canonical = await fetch(
        `http://127.0.0.1:${address.port}/health/check`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const legacy = await fetch(
        `http://127.0.0.1:${address.port}/health_check`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      expect(readiness.status).toBe(200);
      expect(await readiness.json()).toEqual({ ok: true });
      expect(canonical.status).toBe(200);
      const canonicalBody = (await canonical.json()) as {
        ok: boolean;
        result?: { sessions?: { active?: number } };
      };
      expect(canonicalBody).toEqual({
        ok: true,
        result: expect.objectContaining({
          sessions: expect.objectContaining({ active: 0 }),
        }),
      });
      expect(legacy.status).toBe(200);
      const legacyBody = (await legacy.json()) as {
        ok: boolean;
        result?: { sessions?: { active?: number } };
      };
      expect(legacyBody).toEqual({
        ok: true,
        result: expect.objectContaining({
          sessions: expect.objectContaining({ active: 0 }),
        }),
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  });
});
