import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ARTIFACTS_DIR_NAME = 'browser-agent';

const resolveTempRoot = (): string =>
  process.env.TMPDIR || process.env.TEMP || process.env.TMP || os.tmpdir();

export const getArtifactRootDir = (sessionId: string): string =>
  path.join(resolveTempRoot(), ARTIFACTS_DIR_NAME, sessionId);

export const ensureArtifactRootDir = async (
  sessionId: string
): Promise<string> => {
  const rootDir = getArtifactRootDir(sessionId);
  await mkdir(rootDir, { recursive: true });
  return rootDir;
};
