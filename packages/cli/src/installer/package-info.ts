import fs from 'node:fs/promises';
import path from 'node:path';

const PACKAGE_NAME = '@btraut/browser-bridge';

const tryReadJson = async (filePath: string): Promise<unknown | null> => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

export const resolveCliPackageRootDir = async (): Promise<string> => {
  // When bundled, `__dirname` may be something like dist/ or dist/installer/
  // (depending on how the bundler preserves module paths). Find the nearest
  // parent directory that contains this package's package.json.
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'package.json');
    const parsed = (await tryReadJson(candidate)) as { name?: unknown } | null;
    if (parsed && parsed.name === PACKAGE_NAME) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    'Unable to locate Browser Bridge package root (package.json).'
  );
};

export const readCliPackageVersion = async (): Promise<string> => {
  const rootDir = await resolveCliPackageRootDir();
  const pkgPath = path.join(rootDir, 'package.json');
  const parsed = (await tryReadJson(pkgPath)) as { version?: unknown } | null;
  if (!parsed || typeof parsed.version !== 'string' || !parsed.version) {
    throw new Error(`Unable to read version from ${pkgPath}`);
  }
  return parsed.version;
};

export const resolveSkillSourceDir = async (): Promise<string> => {
  const rootDir = await resolveCliPackageRootDir();

  const packaged = path.join(rootDir, 'skills', 'browser-bridge');
  try {
    await fs.stat(packaged);
    return packaged;
  } catch {
    // In-repo dev usage: `npm run build` does not stage `packages/cli/skills/*`
    // (that happens at npm pack time). Fall back to the repo-local Codex skill.
  }

  const repoRoot = path.resolve(rootDir, '..', '..');
  const repoSkill = path.join(repoRoot, '.agents', 'skills', 'browser-bridge');
  try {
    await fs.stat(repoSkill);
    return repoSkill;
  } catch {
    // ignore
  }

  throw new Error(
    `Unable to locate packaged skill. Expected ${packaged} (npm install) or ${repoSkill} (repo dev).`
  );
};
