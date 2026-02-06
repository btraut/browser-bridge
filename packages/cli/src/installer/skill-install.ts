import fs from 'node:fs/promises';
import path from 'node:path';

import { writeSkillManifest } from './skill-manifest';

export type SkillInstallResult = {
  ok: true;
  destDir: string;
};

export const installBrowserBridgeSkill = async (options: {
  srcSkillDir: string;
  destSkillsDir: string;
  version: string;
}): Promise<SkillInstallResult> => {
  const destDir = path.join(options.destSkillsDir, 'browser-bridge');

  await fs.mkdir(options.destSkillsDir, { recursive: true });
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.cp(options.srcSkillDir, destDir, { recursive: true });

  // Ensure the installed copy has a version marker that matches the app.
  await writeSkillManifest(destDir, options.version);

  return { ok: true, destDir };
};
