import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliRoot = path.resolve(__dirname, '..');

const rmrf = async (p) => fs.rm(p, { recursive: true, force: true });

await rmrf(path.join(cliRoot, 'extension'));
await rmrf(path.join(cliRoot, 'skills'));

// These are copied from repo root in prepack so the npm page uses the canonical
// README and the tarball includes a top-level LICENSE.
await rmrf(path.join(cliRoot, 'README.md'));
await rmrf(path.join(cliRoot, 'LICENSE'));
await rmrf(path.join(cliRoot, 'CHANGELOG.md'));
