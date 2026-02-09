import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const extensionRoot = path.join(repoRoot, 'packages', 'extension');
const outdir = path.join(extensionRoot, 'dist');

// Keep the unpacked extension dir clean (avoids publishing stale build outputs).
await fs.rm(outdir, { recursive: true, force: true });
await fs.mkdir(outdir, { recursive: true });

const buildClassicScript = async (infile, outfile) => {
  // MV3 classic scripts must not contain top-level `import`/`export`. Bundle to an IIFE.
  await build({
    entryPoints: [infile],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: true,
    logLevel: 'info',
  });
};

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

await buildClassicScript(
  path.join(extensionRoot, 'src', 'content.ts'),
  path.join(outdir, 'content.js')
);

await buildClassicScript(
  path.join(extensionRoot, 'src', 'permission-prompt-ui.ts'),
  path.join(outdir, 'permission-prompt-ui.js')
);

await buildClassicScript(
  path.join(extensionRoot, 'src', 'options-ui.ts'),
  path.join(outdir, 'options-ui.js')
);

await buildClassicScript(
  path.join(extensionRoot, 'src', 'popup-ui.ts'),
  path.join(outdir, 'popup-ui.js')
);
