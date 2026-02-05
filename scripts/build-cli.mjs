import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const cliRoot = path.join(repoRoot, 'packages', 'cli');
const outdir = path.join(cliRoot, 'dist');

const pkg = JSON.parse(
  await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8')
);

const dependencyNames = Object.keys(pkg.dependencies ?? {});
const external = dependencyNames.flatMap((name) => [name, `${name}/*`]);

const internalEntrypoints = new Map([
  [
    '@btraut/browser-bridge-core',
    path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
  ],
  [
    '@btraut/browser-bridge-shared',
    path.join(repoRoot, 'packages', 'shared', 'src', 'index.ts'),
  ],
  [
    '@btraut/browser-bridge-mcp-adapter',
    path.join(repoRoot, 'packages', 'mcp-adapter', 'src', 'index.ts'),
  ],
]);

const internalWorkspacePlugin = {
  name: 'internal-workspace',
  setup(buildCtx) {
    buildCtx.onResolve({ filter: /^@btraut\/browser-bridge-/ }, (args) => {
      const resolved = internalEntrypoints.get(args.path);
      if (!resolved) {
        return null;
      }
      return { path: resolved };
    });
  },
};

await fs.rm(outdir, { recursive: true, force: true });
await fs.mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: true,
  logLevel: 'info',
  plugins: [internalWorkspacePlugin],
  external,
};

await build({
  ...common,
  entryPoints: [path.join(cliRoot, 'src', 'index.ts')],
  outfile: path.join(outdir, 'index.js'),
  banner: { js: '#!/usr/bin/env node' },
});

await build({
  ...common,
  entryPoints: [path.join(cliRoot, 'src', 'api.ts')],
  outfile: path.join(outdir, 'api.js'),
});

// Publish-time types: keep minimal and self-contained (no refs to unpublished
// workspace packages, and no dependency on @types/* packages).
await fs.copyFile(
  path.join(cliRoot, 'src', 'api.d.ts'),
  path.join(outdir, 'api.d.ts')
);
