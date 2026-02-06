import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
};

const runCapture = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
  return String(result.stdout ?? '').trim();
};

const repoRoot = process.cwd();

const runMain = async () => {
  const pkg = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'package.json'))
  );
  const version = String(pkg.version ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid package.json version: ${version}`);
  }

  const tag = `v${version}`;
  const allowDirty = process.argv.includes('--allow-dirty');

  if (!allowDirty) {
    // Ensure working tree is clean to avoid tagging uncommitted changes.
    const diff = runCapture('git', ['status', '--porcelain']);
    if (diff.length > 0) {
      throw new Error(
        'Working tree is not clean. Commit changes before tagging (or pass --allow-dirty).'
      );
    }
  }

  // Fail if tag already exists.
  const existing = runCapture('git', ['tag', '--list', tag]);
  if (existing === tag) {
    throw new Error(`Tag already exists: ${tag}`);
  }

  run('git', ['tag', '-a', tag, '-m', tag]);
  console.log(`Created tag ${tag}`);
};

runMain().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
