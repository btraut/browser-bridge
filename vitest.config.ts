import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages are bundled for the published CLI, but unit tests run
      // against source. Alias package imports to their TS entrypoints.
      '@btraut/browser-bridge-shared': path.resolve(
        __dirname,
        'packages/shared/src/index.ts'
      ),
      '@btraut/browser-bridge-core': path.resolve(
        __dirname,
        'packages/core/src/index.ts'
      ),
      '@btraut/browser-bridge-mcp-adapter': path.resolve(
        __dirname,
        'packages/mcp-adapter/src/index.ts'
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
  },
});
