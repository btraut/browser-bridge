import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const extensionRoot = path.join(repoRoot, 'packages', 'extension');
const outdir = path.join(extensionRoot, 'dist');

// MV3 background service workers can be ESM ("type": "module").
await build({
  entryPoints: [path.join(extensionRoot, 'src', 'background.ts')],
  outfile: path.join(outdir, 'background.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
});

// MV3 content scripts are *not* module scripts; they must not contain top-level
// `import`/`export`. Bundle to an IIFE to guarantee classic-script compatibility.
await build({
  entryPoints: [path.join(extensionRoot, 'src', 'content.ts')],
  outfile: path.join(outdir, 'content.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
});
