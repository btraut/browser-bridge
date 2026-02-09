import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const maybeCopyFile = async (fromPath, toPath) => {
  try {
    await fs.cp(fromPath, toPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const usage = () => {
  console.error(
    [
      'Usage:',
      '  node scripts/package-extension.mjs [--out <path>]',
      '',
      'Builds the MV3 extension and outputs a zip containing:',
      '- manifest.json (version set to repo version)',
      '- dist/',
      '- assets/',
    ].join('\n')
  );
};

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outOverride = outIndex !== -1 ? args[outIndex + 1] : undefined;
if (outIndex !== -1 && !outOverride) {
  usage();
  process.exitCode = 2;
  process.exit();
}

const repoRoot = process.cwd();
const rootPkg = await readJson(path.join(repoRoot, 'package.json'));
const version = String(rootPkg.version ?? '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid package.json version: ${version}`);
}

const extensionRoot = path.join(repoRoot, 'packages', 'extension');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const distPath = path.join(extensionRoot, 'dist');
const assetsPath = path.join(extensionRoot, 'assets');

// Ensure fresh build outputs exist.
run(process.execPath, [path.join(repoRoot, 'scripts', 'build-extension.mjs')]);

const outDir = outOverride
  ? path.dirname(path.resolve(outOverride))
  : path.join(repoRoot, 'dist');
await fs.mkdir(outDir, { recursive: true });
const outPath =
  outOverride ?? path.join(outDir, `browser-bridge-extension-v${version}.zip`);
await fs.rm(outPath, { force: true });

const stagingRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), 'browser-bridge-extension-')
);
try {
  // Stage manifest with version synced to repo version.
  const manifest = await readJson(manifestPath);
  manifest.version = version;
  await writeJson(path.join(stagingRoot, 'manifest.json'), manifest);

  await fs.cp(distPath, path.join(stagingRoot, 'dist'), { recursive: true });
  await fs.cp(assetsPath, path.join(stagingRoot, 'assets'), {
    recursive: true,
  });
  await maybeCopyFile(
    path.join(extensionRoot, 'permission.html'),
    path.join(stagingRoot, 'permission.html')
  );
  await maybeCopyFile(
    path.join(extensionRoot, 'options.html'),
    path.join(stagingRoot, 'options.html')
  );
  await maybeCopyFile(
    path.join(extensionRoot, 'popup.html'),
    path.join(stagingRoot, 'popup.html')
  );

  // Zip the staged extension directory.
  run('zip', ['-r', outPath, '.'], { cwd: stagingRoot });
  console.log(outPath);
} finally {
  await fs.rm(stagingRoot, { recursive: true, force: true });
}
