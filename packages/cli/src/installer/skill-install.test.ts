import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { installBrowserBridgeSkill } from './skill-install';
import { readSkillManifest, SKILL_MANIFEST_FILENAME } from './skill-manifest';

const mkdirTemp = async (prefix: string): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), prefix));

describe('skill install', () => {
  it('copies the skill and writes a version manifest (overwrite)', async () => {
    const srcRoot = await mkdirTemp('bb-skill-src-');
    const destRoot = await mkdirTemp('bb-skill-dest-');

    const srcSkillDir = path.join(srcRoot, 'browser-bridge');
    await fs.mkdir(srcSkillDir, { recursive: true });
    await fs.writeFile(path.join(srcSkillDir, 'SKILL.md'), '# Skill\n', 'utf8');

    const destSkillsDir = path.join(destRoot, 'skills');
    const version = '0.0.0-test';

    // First install
    const first = await installBrowserBridgeSkill({
      srcSkillDir,
      destSkillsDir,
      version,
    });
    expect(first.ok).toBe(true);

    const installedDir = path.join(destSkillsDir, 'browser-bridge');
    const skillMd = await fs.readFile(
      path.join(installedDir, 'SKILL.md'),
      'utf8'
    );
    expect(skillMd).toContain('# Skill');

    const manifest = await readSkillManifest(installedDir);
    expect(manifest?.version).toBe(version);

    // Overwrite install should replace files
    await fs.writeFile(
      path.join(installedDir, 'SKILL.md'),
      'mutated\n',
      'utf8'
    );
    await fs.rm(path.join(installedDir, SKILL_MANIFEST_FILENAME), {
      force: true,
    });

    await installBrowserBridgeSkill({
      srcSkillDir,
      destSkillsDir,
      version,
    });

    const skillMdAfter = await fs.readFile(
      path.join(installedDir, 'SKILL.md'),
      'utf8'
    );
    expect(skillMdAfter).toContain('# Skill');

    const manifestAfter = await readSkillManifest(installedDir);
    expect(manifestAfter?.version).toBe(version);
  });
});
