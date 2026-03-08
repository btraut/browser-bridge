import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3210;
const ENV_CORE_HOST = 'BROWSER_BRIDGE_CORE_HOST';
const ENV_VISION_HOST = 'BROWSER_VISION_CORE_HOST';
const ENV_CORE_PORT = 'BROWSER_BRIDGE_CORE_PORT';
const ENV_VISION_PORT = 'BROWSER_VISION_CORE_PORT';
const ENV_BRIDGE_CWD = 'BROWSER_BRIDGE_CWD';
const ENV_PROCESS_PWD = 'PWD';
const ENV_PROCESS_INIT_CWD = 'INIT_CWD';
const ENV_PROCESS_HOME = 'HOME';

export const RUNTIME_METADATA_RELATIVE_PATH =
  '.context/browser-bridge/dev.json';
export const DEFAULT_LOG_DIRECTORY_RELATIVE_PATH =
  '.context/logs/browser-bridge';

export type RuntimeMetadata = {
  extension_id?: string;
  updated_at?: string;
};

export type ResolveCoreRuntimeOptions = {
  host?: string;
  port?: number | string;
  cwd?: string;
  gitRoot?: string | null;
  metadataPath?: string;
  metadata?: RuntimeMetadata | null;
  env?: Record<string, string | undefined>;
  strictEnvPort?: boolean;
};

export type ResolvedCoreRuntime = {
  host: string;
  port: number;
  hostSource: 'option' | 'env' | 'default';
  portSource: 'option' | 'env' | 'default';
  metadataPath: string;
  metadata: RuntimeMetadata | null;
  gitRoot: string | null;
};

const normalizeCandidatePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return resolve(trimmed);
};

const resolveCwd = (cwd?: string): string => {
  const explicit = normalizeCandidatePath(cwd);
  if (explicit) {
    return explicit;
  }

  const envExplicit = normalizeCandidatePath(process.env[ENV_BRIDGE_CWD]);
  if (envExplicit) {
    return envExplicit;
  }

  const processCwd = normalizeCandidatePath(process.cwd());
  if (processCwd && processCwd !== '/') {
    return processCwd;
  }

  const processPwd = normalizeCandidatePath(process.env[ENV_PROCESS_PWD]);
  if (processPwd && processPwd !== '/') {
    return processPwd;
  }

  const initCwd = normalizeCandidatePath(process.env[ENV_PROCESS_INIT_CWD]);
  if (initCwd && initCwd !== '/') {
    return initCwd;
  }

  const home = normalizeCandidatePath(process.env[ENV_PROCESS_HOME]);
  if (home) {
    return home;
  }

  return processCwd ?? resolve('.');
};

const resolveOptionalPath = (
  cwd: string,
  value?: string
): string | undefined => {
  if (!value) {
    return undefined;
  }
  return isAbsolute(value) ? value : resolve(cwd, value);
};

const normalizeHost = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parsePort = (
  value: unknown,
  label: string,
  invalidPolicy: 'throw' | 'ignore'
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }

  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  if (invalidPolicy === 'throw') {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return undefined;
};

const resolveEnvHost = (
  env: Record<string, string | undefined>
): string | undefined => {
  const bridgeHost = normalizeHost(env[ENV_CORE_HOST]);
  if (bridgeHost) {
    return bridgeHost;
  }
  return normalizeHost(env[ENV_VISION_HOST]);
};

const resolveEnvPortRaw = (
  env: Record<string, string | undefined>
): string | undefined => {
  if (env[ENV_CORE_PORT] !== undefined) {
    return env[ENV_CORE_PORT];
  }
  return env[ENV_VISION_PORT];
};

const sanitizeMetadata = (raw: unknown): RuntimeMetadata | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const extensionId = normalizeHost(candidate.extension_id);
  const updatedAt = normalizeHost(candidate.updated_at);

  if (!extensionId && !updatedAt) {
    return null;
  }

  return {
    extension_id: extensionId,
    updated_at: updatedAt,
  };
};

export const findGitRoot = (cwd?: string): string | null => {
  let current = resolveCwd(cwd);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

export const resolveRuntimeMetadataPath = ({
  cwd,
  gitRoot,
  metadataPath,
}: {
  cwd?: string;
  gitRoot?: string | null;
  metadataPath?: string;
} = {}): string => {
  const resolvedCwd = resolveCwd(cwd);
  const providedPath = resolveOptionalPath(resolvedCwd, metadataPath);
  if (providedPath) {
    return providedPath;
  }
  const root = gitRoot ?? findGitRoot(resolvedCwd) ?? resolvedCwd;
  return join(root, RUNTIME_METADATA_RELATIVE_PATH);
};

export const resolveLogDirectory = ({
  cwd,
  gitRoot,
  logDir,
}: {
  cwd?: string;
  gitRoot?: string | null;
  logDir?: string;
} = {}): string => {
  const resolvedCwd = resolveCwd(cwd);
  const providedPath = resolveOptionalPath(resolvedCwd, logDir);
  if (providedPath) {
    return providedPath;
  }

  const resolvedGitRoot =
    gitRoot === undefined
      ? findGitRoot(resolvedCwd)
      : gitRoot
        ? resolve(gitRoot)
        : null;

  return join(
    resolvedGitRoot ?? resolvedCwd,
    DEFAULT_LOG_DIRECTORY_RELATIVE_PATH
  );
};

export const readRuntimeMetadata = ({
  cwd,
  gitRoot,
  metadataPath,
}: {
  cwd?: string;
  gitRoot?: string | null;
  metadataPath?: string;
} = {}): RuntimeMetadata | null => {
  const path = resolveRuntimeMetadataPath({ cwd, gitRoot, metadataPath });
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeMetadata(parsed);
  } catch {
    return null;
  }
};

export const writeRuntimeMetadata = (
  metadata: RuntimeMetadata,
  {
    cwd,
    gitRoot,
    metadataPath,
  }: {
    cwd?: string;
    gitRoot?: string | null;
    metadataPath?: string;
  } = {}
): string => {
  const path = resolveRuntimeMetadataPath({ cwd, gitRoot, metadataPath });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return path;
};

export const resolveCoreRuntime = (
  options: ResolveCoreRuntimeOptions = {}
): ResolvedCoreRuntime => {
  const env = options.env ?? process.env;
  const resolvedCwd = resolveCwd(options.cwd);
  const gitRoot =
    options.gitRoot === undefined
      ? findGitRoot(resolvedCwd)
      : options.gitRoot
        ? resolve(options.gitRoot)
        : null;

  const metadataPath = resolveRuntimeMetadataPath({
    cwd: resolvedCwd,
    gitRoot,
    metadataPath: options.metadataPath,
  });

  const metadata =
    options.metadata === undefined
      ? readRuntimeMetadata({ metadataPath })
      : sanitizeMetadata(options.metadata);

  const optionHost = normalizeHost(options.host);
  const envHost = resolveEnvHost(env);
  const host = optionHost ?? envHost ?? DEFAULT_HOST;
  const hostSource: ResolvedCoreRuntime['hostSource'] = optionHost
    ? 'option'
    : envHost
      ? 'env'
      : 'default';

  const optionPort = parsePort(options.port, 'port', 'throw');
  const envPort = parsePort(
    resolveEnvPortRaw(env),
    'port',
    options.strictEnvPort ? 'throw' : 'ignore'
  );
  const port = optionPort ?? envPort ?? DEFAULT_PORT;
  const portSource: ResolvedCoreRuntime['portSource'] =
    optionPort !== undefined
      ? 'option'
      : envPort !== undefined
        ? 'env'
        : 'default';

  return {
    host,
    port,
    hostSource,
    portSource,
    metadataPath,
    metadata,
    gitRoot,
  };
};
