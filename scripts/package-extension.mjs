import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const extensionRoot = path.join(repoRoot, 'packages', 'extension');
const artifactsDir = path.join(repoRoot, 'dist');

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const run = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
};

const normalizeTag = (raw) => {
  const tag = String(raw ?? '').trim();
  if (!tag) {
    return null;
  }
  if (/^v\d+\.\d+\.\d+$/.test(tag)) {
    return tag;
  }
  if (/^\d+\.\d+\.\d+$/.test(tag)) {
    return `v${tag}`;
  }
  throw new Error(
    `Invalid tag/version "${tag}". Expected vMAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH.`
  );
};

const maybeNormalizeTag = (raw) => {
  try {
    return normalizeTag(raw);
  } catch {
    return null;
  }
};

const runMain = async () => {
  await fs.mkdir(artifactsDir, { recursive: true });

  const pkg = await readJson(path.join(repoRoot, 'package.json'));
  const defaultTag = normalizeTag(`v${pkg.version}`);
  const tag =
    normalizeTag(process.env.EXTENSION_TAG) ??
    maybeNormalizeTag(process.env.GITHUB_REF_NAME) ??
    defaultTag;

  const version = tag.replace(/^v/, '');
  const bundleRootName = `browser-bridge-extension-${tag}`;
  const zipPath = path.join(artifactsDir, `${bundleRootName}.zip`);

  // Stage an unpacked extension folder so the zip unpacks into a single dir
  // that users can "Load unpacked" in chrome://extensions.
  const stageDir = await fs.mkdtemp(path.join(artifactsDir, 'ext-stage-'));
  try {
    const bundleRoot = path.join(stageDir, bundleRootName);
    await fs.mkdir(bundleRoot, { recursive: true });

    // Ensure the extension has been built (expects packages/extension/dist).
    const builtDist = path.join(extensionRoot, 'dist');
    await fs.stat(builtDist);

    const manifest = await readJson(path.join(extensionRoot, 'manifest.json'));
    manifest.version = version;
    await writeJson(path.join(bundleRoot, 'manifest.json'), manifest);

    // Keep the zip minimal: just what Chrome needs to load the extension.
    await fs.cp(
      path.join(extensionRoot, 'assets'),
      path.join(bundleRoot, 'assets'),
      { recursive: true }
    );
    await fs.cp(builtDist, path.join(bundleRoot, 'dist'), { recursive: true });

    // Create/overwrite the zip.
    await fs.rm(zipPath, { force: true });
    run('zip', ['-r', zipPath, bundleRootName], { cwd: stageDir });
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }

  console.log(zipPath);
};

runMain().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
