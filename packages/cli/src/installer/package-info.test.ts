import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  readCliPackageVersion,
  resolveCliPackageRootDir,
  resolveSkillSourceDir,
} from './package-info';

describe('package info', () => {
  it('finds the CLI package root and version', async () => {
    const root = await resolveCliPackageRootDir();
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { name?: string; version?: string };
    expect(parsed.name).toBe('@btraut/browser-bridge');

    const version = await readCliPackageVersion();
    expect(version).toBe(parsed.version);
  });

  it('resolves a skill source directory (packaged or repo fallback)', async () => {
    const dir = await resolveSkillSourceDir();
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});
