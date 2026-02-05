import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOpenArtifactsCommand } from './open-artifacts';
import { ensureArtifactRootDir } from '@btraut/browser-bridge-core';
import { openPath } from '../open-path';
import { runLocal } from '../cli-runtime';

vi.mock('@btraut/browser-bridge-core', () => ({
  ensureArtifactRootDir: vi.fn(),
}));

vi.mock('../open-path', () => ({
  openPath: vi.fn(),
}));

vi.mock('../cli-runtime', () => ({
  runLocal: vi.fn(),
}));

const buildProgram = (): Command => {
  const program = new Command();
  registerOpenArtifactsCommand(program);
  program.exitOverride();
  return program;
};

describe('open-artifacts command', () => {
  beforeEach(() => {
    vi.mocked(runLocal).mockReset();
    vi.mocked(ensureArtifactRootDir).mockReset();
    vi.mocked(openPath).mockReset();
  });

  it('opens the session artifact directory', async () => {
    const rootDir = '/tmp/artifacts/session-1';
    vi.mocked(ensureArtifactRootDir).mockResolvedValue(rootDir);

    let result: unknown;
    vi.mocked(runLocal).mockImplementation(async (_command, work) => {
      result = await work({ json: false } as { json: boolean });
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'open-artifacts',
      '--session-id',
      'session-1',
    ]);

    expect(ensureArtifactRootDir).toHaveBeenCalledWith('session-1');
    expect(openPath).toHaveBeenCalledWith(rootDir);
    expect(result).toEqual({
      ok: true,
      result: { path: rootDir, opened: true },
    });
  });
});
