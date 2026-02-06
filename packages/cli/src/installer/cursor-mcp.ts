import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Platform = string;

export const resolveCursorUserSettingsPath = (options?: {
  platform?: Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}): string => {
  const platform = options?.platform ?? process.platform;
  const homeDir = options?.homeDir ?? os.homedir();
  const env = options?.env ?? process.env;

  if (platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'settings.json'
    );
  }

  if (platform === 'win32') {
    const appData = env.APPDATA;
    if (!appData) {
      throw new Error(
        'APPDATA is not set; cannot resolve Cursor settings path.'
      );
    }
    return path.join(appData, 'Cursor', 'User', 'settings.json');
  }

  // Linux and other unix-like platforms: follow VS Code convention.
  return path.join(homeDir, '.config', 'Cursor', 'User', 'settings.json');
};

export const installCursorMcp = async (
  settingsPath?: string
): Promise<{ settingsPath: string }> => {
  const filePath = settingsPath ?? resolveCursorUserSettingsPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  let settings: JsonObject = {};
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isObject(parsed)) {
      settings = parsed;
    } else {
      throw new Error('Cursor settings.json is not a JSON object.');
    }
  } catch (error) {
    // If it doesn't exist, initialize a new settings object.
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      settings = {};
    } else {
      throw error;
    }
  }

  const mcp = isObject(settings.mcp) ? settings.mcp : {};
  const servers = isObject(mcp.servers) ? mcp.servers : {};
  servers['browser-bridge'] = {
    command: 'browser-bridge',
    args: ['mcp'],
  };
  mcp.servers = servers;
  settings.mcp = mcp;

  await fs.writeFile(
    filePath,
    JSON.stringify(settings, null, 2) + '\n',
    'utf8'
  );

  return { settingsPath: filePath };
};
