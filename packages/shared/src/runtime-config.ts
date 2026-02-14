import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const LEGACY_DEFAULT_PORT = 3210;
const DETERMINISTIC_PORT_WINDOW = 2000;
const ENV_CORE_HOST = 'BROWSER_BRIDGE_CORE_HOST';
const ENV_VISION_HOST = 'BROWSER_VISION_CORE_HOST';
const ENV_CORE_PORT = 'BROWSER_BRIDGE_CORE_PORT';
const ENV_VISION_PORT = 'BROWSER_VISION_CORE_PORT';

export const RUNTIME_METADATA_RELATIVE_PATH =
  '.context/browser-bridge/dev.json';

export type RuntimeMetadata = {
  host?: string;
  port?: number;
  git_root?: string;
  worktree_id?: string;
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
  hostSource: 'option' | 'env' | 'metadata' | 'default';
  portSource: 'option' | 'env' | 'metadata' | 'deterministic';
  metadataPath: string;
  metadata: RuntimeMetadata | null;
  gitRoot: string | null;
  worktreeId: string | null;
  deterministicPort: number;
};

const resolveCwd = (cwd?: string): string => resolve(cwd ?? process.cwd());

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

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const normalizePathForHash = (value: string): string =>
  value.replace(/\\/g, '/').toLowerCase();

const sanitizeToken = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const fallbackWorktreeId = (gitRoot: string): string => {
  const hash = hashString(normalizePathForHash(gitRoot))
    .toString(16)
    .padStart(8, '0');
  return `wt-${hash}`;
};

const extractWorktreeIdFromGitDir = (gitDir: string): string | null => {
  const normalized = gitDir.replace(/\\/g, '/');
  const marker = '/.git/worktrees/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const remainder = normalized.slice(markerIndex + marker.length);
  const rawId = remainder.split('/')[0];
  if (!rawId) {
    return null;
  }
  const sanitized = sanitizeToken(rawId);
  return sanitized.length > 0 ? sanitized : null;
};

const readWorktreeGitDir = (gitRoot: string): string | null => {
  const gitPath = join(gitRoot, '.git');
  try {
    const stats = statSync(gitPath);
    if (stats.isDirectory()) {
      return gitPath;
    }
    if (!stats.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const raw = readFileSync(gitPath, 'utf8');
    const match = raw.match(/^gitdir:\s*(.+)$/m);
    if (!match?.[1]) {
      return null;
    }
    const candidate = match[1].trim();
    return isAbsolute(candidate) ? candidate : resolve(gitRoot, candidate);
  } catch {
    return null;
  }
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
  const host = normalizeHost(candidate.host);
  const port = parsePort(candidate.port, 'port', 'ignore');
  const gitRoot = normalizeHost(candidate.git_root);
  const worktreeId = normalizeHost(candidate.worktree_id);
  const updatedAt = normalizeHost(candidate.updated_at);

  if (!host && port === undefined && !gitRoot && !worktreeId && !updatedAt) {
    return null;
  }

  return {
    host,
    port,
    git_root: gitRoot,
    worktree_id: worktreeId,
    updated_at: updatedAt,
  };
};

export const findGitRoot = (cwd = process.cwd()): string | null => {
  let current = resolve(cwd);
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

export const resolveWorktreeId = ({
  cwd,
  gitRoot,
}: {
  cwd?: string;
  gitRoot?: string | null;
} = {}): string | null => {
  const resolvedGitRoot = gitRoot ?? findGitRoot(resolveCwd(cwd));
  if (!resolvedGitRoot) {
    return null;
  }
  const gitDir = readWorktreeGitDir(resolvedGitRoot);
  const parsedId = gitDir ? extractWorktreeIdFromGitDir(gitDir) : null;
  if (parsedId) {
    return parsedId;
  }
  return fallbackWorktreeId(resolvedGitRoot);
};

export const resolveDeterministicCorePort = ({
  cwd,
  gitRoot,
}: {
  cwd?: string;
  gitRoot?: string | null;
} = {}): number => {
  const resolvedGitRoot = gitRoot ?? findGitRoot(resolveCwd(cwd));
  if (!resolvedGitRoot) {
    return LEGACY_DEFAULT_PORT;
  }
  const seed = normalizePathForHash(resolvedGitRoot);
  return LEGACY_DEFAULT_PORT + (hashString(seed) % DETERMINISTIC_PORT_WINDOW);
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

export const createBoundedPortProbeSequence = (
  startPort: number,
  maxAttempts = 20,
  maxPort = 65535
): number[] => {
  const normalizedStart = parsePort(startPort, 'startPort', 'throw');
  if (normalizedStart === undefined) {
    throw new Error(`Invalid startPort: ${String(startPort)}`);
  }
  const attempts = Math.max(1, Math.floor(maxAttempts));
  const ceiling = Math.min(65535, Math.max(1, Math.floor(maxPort)));

  if (normalizedStart > ceiling) {
    throw new Error(`startPort ${normalizedStart} exceeds maxPort ${ceiling}.`);
  }

  const sequence: number[] = [];
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = normalizedStart + offset;
    if (port > ceiling) {
      break;
    }
    sequence.push(port);
  }
  return sequence;
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

  const deterministicPort = resolveDeterministicCorePort({
    cwd: resolvedCwd,
    gitRoot,
  });

  const optionHost = normalizeHost(options.host);
  const envHost = resolveEnvHost(env);
  const metadataHost = normalizeHost(metadata?.host);

  const host = optionHost ?? envHost ?? metadataHost ?? DEFAULT_HOST;
  const hostSource: ResolvedCoreRuntime['hostSource'] = optionHost
    ? 'option'
    : envHost
      ? 'env'
      : metadataHost
        ? 'metadata'
        : 'default';

  const optionPort = parsePort(options.port, 'port', 'throw');
  const envPort = parsePort(
    resolveEnvPortRaw(env),
    'port',
    options.strictEnvPort ? 'throw' : 'ignore'
  );
  const metadataPort = parsePort(metadata?.port, 'port', 'ignore');

  let port: number;
  let portSource: ResolvedCoreRuntime['portSource'];

  if (optionPort !== undefined) {
    port = optionPort;
    portSource = 'option';
  } else if (envPort !== undefined) {
    port = envPort;
    portSource = 'env';
  } else if (metadataPort !== undefined) {
    port = metadataPort;
    portSource = 'metadata';
  } else {
    port = deterministicPort;
    portSource = 'deterministic';
  }

  return {
    host,
    port,
    hostSource,
    portSource,
    metadataPath,
    metadata,
    gitRoot,
    worktreeId: resolveWorktreeId({ cwd: resolvedCwd, gitRoot }),
    deterministicPort,
  };
};
