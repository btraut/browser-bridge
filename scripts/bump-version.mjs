import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const parseSemver = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const formatSemver = ({ major, minor, patch }) => `${major}.${minor}.${patch}`;

const bump = (current, kind) => {
  const next = { ...current };
  if (kind === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
    return next;
  }
  if (kind === 'minor') {
    next.minor += 1;
    next.patch = 0;
    return next;
  }
  if (kind === 'patch') {
    next.patch += 1;
    return next;
  }
  throw new Error(`Unknown bump kind: ${kind}`);
};

const args = process.argv.slice(2);
const usage = () => {
  console.error(
    [
      'Usage:',
      '  node scripts/bump-version.mjs patch|minor|major',
      '  node scripts/bump-version.mjs --to <x.y.z>',
    ].join('\n')
  );
};

const repoRoot = process.cwd();
const rootPkgPath = path.join(repoRoot, 'package.json');
const packagesRoot = path.join(repoRoot, 'packages');
const extensionManifestPath = path.join(
  repoRoot,
  'packages',
  'extension',
  'manifest.json'
);

const run = async () => {
  let targetVersion;
  const toIndex = args.indexOf('--to');
  if (toIndex !== -1) {
    targetVersion = args[toIndex + 1];
    if (!targetVersion) {
      usage();
      process.exitCode = 2;
      return;
    }
    parseSemver(targetVersion);
  } else {
    const kind = args[0];
    if (!kind || !['patch', 'minor', 'major'].includes(kind)) {
      usage();
      process.exitCode = 2;
      return;
    }
    const rootPkg = await readJson(rootPkgPath);
    const current = parseSemver(String(rootPkg.version ?? ''));
    targetVersion = formatSemver(bump(current, kind));
  }

  const pkgPaths = [rootPkgPath];
  const entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    pkgPaths.push(path.join(packagesRoot, entry.name, 'package.json'));
  }

  for (const pkgPath of pkgPaths) {
    const pkg = await readJson(pkgPath);
    if (typeof pkg.version !== 'string') {
      continue;
    }
    pkg.version = targetVersion;
    await writeJson(pkgPath, pkg);
  }

  // Keep the Chrome extension manifest version in sync with the repo version.
  // (Manifest versions must be monotonically increasing for Chrome updates.)
  const manifest = await readJson(extensionManifestPath);
  if (typeof manifest === 'object' && manifest && 'version' in manifest) {
    manifest.version = targetVersion;
    await writeJson(extensionManifestPath, manifest);
  }

  console.log(`Bumped versions to ${targetVersion}`);
};

run().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
