import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliRoot, '..', '..');
const cliPkg = JSON.parse(
  await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8')
);

const run = async (cmd, args, options = {}) => {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: repoRoot,
      ...options,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
    child.on('error', reject);
  });
};

const rmrf = async (p) => fs.rm(p, { recursive: true, force: true });
const mkdirp = async (p) => fs.mkdir(p, { recursive: true });

// 1) Build publish artifacts (CLI bundle + extension bundle).
await run(process.execPath, [path.join(repoRoot, 'scripts', 'build-cli.mjs')]);
await run(process.execPath, [
  path.join(repoRoot, 'scripts', 'build-extension.mjs'),
]);

// 2) Stage README + LICENSE (root is canonical).
await fs.copyFile(
  path.join(repoRoot, 'README.md'),
  path.join(cliRoot, 'README.md')
);
await fs.copyFile(
  path.join(repoRoot, 'LICENSE'),
  path.join(cliRoot, 'LICENSE')
);
await fs.copyFile(
  path.join(repoRoot, 'CHANGELOG.md'),
  path.join(cliRoot, 'CHANGELOG.md')
);

// 3) Stage extension assets so users can load unpacked from node_modules.
const stagedExtensionRoot = path.join(cliRoot, 'extension');
await rmrf(stagedExtensionRoot);
await mkdirp(stagedExtensionRoot);

const extensionRoot = path.join(repoRoot, 'packages', 'extension');
for (const entry of ['manifest.json', 'dist', 'assets']) {
  await fs.cp(
    path.join(extensionRoot, entry),
    path.join(stagedExtensionRoot, entry),
    {
      recursive: true,
    }
  );
}

// 4) Stage Codex/Claude skill.
const stagedSkillsRoot = path.join(cliRoot, 'skills');
await rmrf(stagedSkillsRoot);
await mkdirp(stagedSkillsRoot);

const skillSrc = path.join(repoRoot, 'docs', 'skills', 'browser-bridge');
const skillDst = path.join(stagedSkillsRoot, 'browser-bridge');
await fs.cp(skillSrc, skillDst, { recursive: true });

// Include a version marker in the staged skill so installs and status checks
// can detect drift between the CLI and installed copies.
await fs.writeFile(
  path.join(skillDst, 'skill.json'),
  JSON.stringify({ name: 'browser-bridge', version: cliPkg.version }, null, 2) +
    '\n'
);
