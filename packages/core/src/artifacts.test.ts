import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ensureArtifactRootDir, getArtifactRootDir } from './artifacts';

describe('artifact helpers', () => {
  it('creates the artifact root directory for a session', async () => {
    const sessionId = `session-test-${randomUUID()}`;
    const rootDir = await ensureArtifactRootDir(sessionId);

    expect(rootDir).toBe(getArtifactRootDir(sessionId));

    const stats = await stat(rootDir);
    expect(stats.isDirectory()).toBe(true);

    await rm(rootDir, { recursive: true, force: true });
  });
});
