import os from 'node:os';
import path from 'node:path';

export type HarnessId =
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'factory'
  | 'opencode'
  | 'gemini'
  | 'github'
  | 'ampcode';

export type HarnessTarget = {
  id: HarnessId;
  label: string;
  skillsDir: string;
  // Whether we can install MCP config automatically.
  supportsMcpInstall: boolean;
};

export const getDefaultHarnessTargets = (homeDir?: string): HarnessTarget[] => {
  const home = homeDir ?? os.homedir();

  // Note: Codex now reads skills from ~/.agents/skills (and may symlink from ~/.codex/skills).
  return [
    {
      id: 'codex',
      label: 'Codex',
      skillsDir: path.join(home, '.agents', 'skills'),
      supportsMcpInstall: true,
    },
    {
      id: 'claude',
      label: 'Claude',
      skillsDir: path.join(home, '.claude', 'skills'),
      supportsMcpInstall: true,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      skillsDir: path.join(home, '.cursor', 'skills'),
      supportsMcpInstall: true,
    },
    {
      id: 'factory',
      label: 'Factory',
      skillsDir: path.join(home, '.factory', 'skills'),
      supportsMcpInstall: false,
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      skillsDir: path.join(home, '.opencode', 'skills'),
      supportsMcpInstall: false,
    },
    {
      id: 'gemini',
      label: 'Gemini',
      skillsDir: path.join(home, '.gemini', 'skills'),
      supportsMcpInstall: false,
    },
    {
      id: 'github',
      label: 'GitHub',
      skillsDir: path.join(home, '.github', 'skills'),
      supportsMcpInstall: false,
    },
    {
      id: 'ampcode',
      label: 'Ampcode',
      skillsDir: path.join(home, '.ampcode', 'skills'),
      supportsMcpInstall: false,
    },
  ];
};
