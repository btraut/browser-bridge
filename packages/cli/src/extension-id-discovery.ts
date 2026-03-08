import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedCoreRuntime } from '@btraut/browser-bridge-shared';
import { createCoreClient } from './core-client';

const ENV_CHROME_USER_DATA_DIR = 'BROWSER_BRIDGE_CHROME_USER_DATA_DIR';
type RuntimePlatform = typeof process.platform;
type RuntimeEnv = Record<string, string | undefined>;

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const BROWSER_BRIDGE_NAME = 'browser bridge';

export type DiscoverySource = 'connected' | 'profile';

export type ExtensionIdDiscoveryResult =
  | {
      kind: 'resolved';
      extensionId: string;
      source: DiscoverySource;
      searchedPaths: string[];
    }
  | {
      kind: 'ambiguous';
      candidates: string[];
      searchedPaths: string[];
    }
  | {
      kind: 'none';
      searchedPaths: string[];
    };

type CoreClientLike = {
  post: (
    path: string,
    body?: unknown
  ) => Promise<{
    ok: boolean;
    result?: {
      extension?: {
        connected?: boolean;
        extension_id?: string;
      };
    };
  }>;
};

type CreateCoreClientLike = (options?: {
  host?: string;
  port?: number | string;
  ensureDaemon?: boolean;
}) => CoreClientLike;

type DiscoveryDependencies = {
  platform?: RuntimePlatform;
  env?: RuntimeEnv;
  homeDir?: string;
  existsSync?: typeof existsSync;
  readFileSync?: typeof readFileSync;
  readdirSync?: typeof readdirSync;
  createCoreClient?: CreateCoreClientLike;
};

type HealthCheckResult = {
  extension?: {
    connected?: boolean;
    extension_id?: string;
  };
};

const normalizeToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isExtensionId = (value: string): boolean =>
  EXTENSION_ID_PATTERN.test(value);

const collectRootDirectories = (
  platform: RuntimePlatform,
  env: RuntimeEnv,
  homeDir: string
): string[] => {
  const roots = new Set<string>();

  const explicitRoots = normalizeToken(env[ENV_CHROME_USER_DATA_DIR]);
  if (explicitRoots) {
    for (const root of explicitRoots.split(',').map((token) => token.trim())) {
      if (root.length > 0) {
        roots.add(root);
      }
    }
  }

  if (platform === 'darwin') {
    roots.add(
      join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')
    );
  }

  if (platform === 'linux') {
    roots.add(join(homeDir, '.config', 'google-chrome'));
    roots.add(join(homeDir, '.config', 'chromium'));
  }

  if (platform === 'win32') {
    const localAppData = normalizeToken(env.LOCALAPPDATA);
    if (localAppData) {
      roots.add(join(localAppData, 'Google', 'Chrome', 'User Data'));
      roots.add(join(localAppData, 'Chromium', 'User Data'));
    }
  }

  return Array.from(roots);
};

const collectSecurePreferencesPaths = (
  roots: string[],
  deps: {
    existsSync: typeof existsSync;
    readdirSync: typeof readdirSync;
  }
): string[] => {
  const paths = new Set<string>();

  for (const root of roots) {
    if (!deps.existsSync(root)) {
      continue;
    }

    paths.add(join(root, 'Secure Preferences'));

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = deps.readdirSync(root, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      paths.add(join(root, String(entry.name), 'Secure Preferences'));
    }
  }

  return Array.from(paths);
};

const extractBrowserBridgeIdsFromSecurePreferences = (
  raw: string
): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const extensions = (parsed as { extensions?: unknown }).extensions;
  if (!extensions || typeof extensions !== 'object') {
    return [];
  }

  const settings = (extensions as { settings?: unknown }).settings;
  if (!settings || typeof settings !== 'object') {
    return [];
  }

  const matches = new Set<string>();

  for (const [id, value] of Object.entries(settings)) {
    if (!isExtensionId(id) || !value || typeof value !== 'object') {
      continue;
    }

    const manifest = (value as { manifest?: unknown }).manifest;
    const name =
      manifest && typeof manifest === 'object'
        ? normalizeToken((manifest as { name?: unknown }).name)?.toLowerCase()
        : undefined;

    const pathValue = normalizeToken(
      (value as { path?: unknown }).path
    )?.toLowerCase();

    if (name === BROWSER_BRIDGE_NAME || pathValue?.includes('browser-bridge')) {
      matches.add(id);
    }
  }

  return Array.from(matches);
};

const discoverProfileExtensionIds = (deps: {
  platform: RuntimePlatform;
  env: RuntimeEnv;
  homeDir: string;
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  readdirSync: typeof readdirSync;
}): {
  extensionIds: string[];
  searchedPaths: string[];
} => {
  const roots = collectRootDirectories(deps.platform, deps.env, deps.homeDir);
  const securePreferencePaths = collectSecurePreferencesPaths(roots, {
    existsSync: deps.existsSync,
    readdirSync: deps.readdirSync,
  });

  const ids = new Set<string>();
  for (const path of securePreferencePaths) {
    if (!deps.existsSync(path)) {
      continue;
    }

    let raw: string;
    try {
      raw = deps.readFileSync(path, 'utf8');
    } catch {
      continue;
    }

    for (const id of extractBrowserBridgeIdsFromSecurePreferences(raw)) {
      ids.add(id);
    }
  }

  return {
    extensionIds: Array.from(ids).sort(),
    searchedPaths: securePreferencePaths.sort(),
  };
};

const discoverConnectedExtensionId = async (
  sharedRuntime: ResolvedCoreRuntime,
  createClient: CreateCoreClientLike
): Promise<string | undefined> => {
  let client: CoreClientLike;
  try {
    client = createClient({
      host: sharedRuntime.host,
      port: sharedRuntime.port,
      ensureDaemon: true,
    }) as CoreClientLike;
  } catch {
    return undefined;
  }

  try {
    const response = await client.post('/health/check', {});
    const extensionId = normalizeToken(
      (response.result as HealthCheckResult | undefined)?.extension
        ?.extension_id
    );
    if (!extensionId || !isExtensionId(extensionId)) {
      return undefined;
    }
    return extensionId;
  } catch {
    return undefined;
  }
};

export const discoverActivationExtensionId = async (
  sharedRuntime: ResolvedCoreRuntime,
  dependencies: DiscoveryDependencies = {}
): Promise<ExtensionIdDiscoveryResult> => {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const homeDir = dependencies.homeDir ?? homedir();
  const exists = dependencies.existsSync ?? existsSync;
  const read = dependencies.readFileSync ?? readFileSync;
  const readDir = dependencies.readdirSync ?? readdirSync;
  const createClient =
    dependencies.createCoreClient ?? (createCoreClient as CreateCoreClientLike);

  const connectedExtensionId = await discoverConnectedExtensionId(
    sharedRuntime,
    createClient
  );
  if (connectedExtensionId) {
    return {
      kind: 'resolved',
      extensionId: connectedExtensionId,
      source: 'connected',
      searchedPaths: [],
    };
  }

  const profileDiscovery = discoverProfileExtensionIds({
    platform,
    env,
    homeDir,
    existsSync: exists,
    readFileSync: read,
    readdirSync: readDir,
  });

  if (profileDiscovery.extensionIds.length === 1) {
    return {
      kind: 'resolved',
      extensionId: profileDiscovery.extensionIds[0],
      source: 'profile',
      searchedPaths: profileDiscovery.searchedPaths,
    };
  }

  if (profileDiscovery.extensionIds.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: profileDiscovery.extensionIds,
      searchedPaths: profileDiscovery.searchedPaths,
    };
  }

  return {
    kind: 'none',
    searchedPaths: profileDiscovery.searchedPaths,
  };
};

export const __private__ = {
  collectRootDirectories,
  collectSecurePreferencesPaths,
  extractBrowserBridgeIdsFromSecurePreferences,
  isExtensionId,
};
