import { describe, expect, it } from 'vitest';
import type { ResolvedCoreRuntime } from '@btraut/browser-bridge-shared';
import {
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
