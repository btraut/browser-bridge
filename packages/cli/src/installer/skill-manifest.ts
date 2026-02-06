import fs from 'node:fs/promises';
import path from 'node:path';

export type SkillManifest = {
  name: 'browser-bridge';
  version: string;
};

export const SKILL_MANIFEST_FILENAME = 'skill.json';

export const readSkillManifest = async (
  skillDir: string
): Promise<SkillManifest | null> => {
  try {
    const raw = await fs.readFile(
      path.join(skillDir, SKILL_MANIFEST_FILENAME),
      'utf8'
    );
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { name?: unknown }).name === 'browser-bridge' &&
      typeof (parsed as { version?: unknown }).version === 'string'
    ) {
      return parsed as SkillManifest;
    }
    return null;
  } catch {
    return null;
  }
};

export const writeSkillManifest = async (
  skillDir: string,
  version: string
): Promise<void> => {
  const payload: SkillManifest = { name: 'browser-bridge', version };
  await fs.writeFile(
    path.join(skillDir, SKILL_MANIFEST_FILENAME),
    JSON.stringify(payload, null, 2) + '\n',
    'utf8'
  );
};
