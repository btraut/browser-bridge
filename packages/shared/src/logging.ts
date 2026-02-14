import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveLogDirectory } from './runtime-config';

export const DEFAULT_LOG_ROTATION_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_LOG_RETENTION = 20;

const DEFAULT_REDACT_KEYS = [
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'apikeyid',
  'privatekey',
  'clientsecret',
];

const REDACTED_VALUE = '[REDACTED]';
const MAX_NORMALIZE_DEPTH = 8;

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export type JsonlLoggerOptions = {
  stream: string;
  cwd?: string;
  gitRoot?: string | null;
  logDir?: string;
  level?: LogLevel;
  bindings?: LogFields;
  redactKeys?: string[];
  maxBytes?: number;
  retention?: number;
  now?: () => Date;
};

export type JsonlLogger = {
  stream: string;
  level: LogLevel;
  logDir: string;
  filePath: string;
  child: (bindings: LogFields) => JsonlLogger;
  log: (level: LogLevel, event: string, fields?: LogFields) => void;
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
};

type LoggerState = {
  stream: string;
  level: LogLevel;
  logDir: string;
  filePath: string;
  maxBytes: number;
  retention: number;
  redactKeys: Set<string>;
  now: () => Date;
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const normalizeRedactionKey = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const sanitizeStreamName = (stream: string): string => {
  const sanitized = stream
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (sanitized.length === 0) {
    throw new Error('Logger stream name must contain visible characters.');
  }
  return sanitized;
};

const normalizeForJson = (
  value: unknown,
  seen: WeakSet<object>,
  depth = 0
): JsonValue => {
  if (value === null) {
    return null;
  }

  if (depth >= MAX_NORMALIZE_DEPTH) {
    return '[MaxDepth]';
  }

  const valueType = typeof value;
  if (
    valueType === 'string' ||
    valueType === 'number' ||
    valueType === 'boolean'
  ) {
    return value as string | number | boolean;
  }

  if (valueType === 'bigint') {
    return String(value);
  }

  if (
    valueType === 'undefined' ||
    valueType === 'symbol' ||
    valueType === 'function'
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item, seen, depth + 1));
  }

  if (value instanceof Set) {
    return Array.from(value.values()).map((item) =>
      normalizeForJson(item, seen, depth + 1)
    );
  }

  if (value instanceof Map) {
    const mapped: Record<string, JsonValue> = {};
    for (const [entryKey, entryValue] of value.entries()) {
      mapped[String(entryKey)] = normalizeForJson(entryValue, seen, depth + 1);
    }
    return mapped;
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return '[Circular]';
    }
    seen.add(objectValue);

    const normalized: Record<string, JsonValue> = {};
    for (const [key, nestedValue] of Object.entries(objectValue)) {
      normalized[key] = normalizeForJson(nestedValue, seen, depth + 1);
    }

    seen.delete(objectValue);
    return normalized;
  }

  return String(value);
};

const redactJson = (value: JsonValue, redactKeys: Set<string>): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, redactKeys));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, JsonValue>;
  const redacted: Record<string, JsonValue> = {};

  for (const [key, nestedValue] of Object.entries(record)) {
    if (redactKeys.has(normalizeRedactionKey(key))) {
      redacted[key] = REDACTED_VALUE;
      continue;
    }
    redacted[key] = redactJson(nestedValue, redactKeys);
  }

  return redacted;
};

const streamFilePath = (logDir: string, stream: string): string =>
  join(logDir, `${stream}.jsonl`);

const rotationFilePath = (
  logDir: string,
  stream: string,
  index: number
): string => join(logDir, `${stream}.${index}.jsonl`);

const rotateStreamFiles = (
  logDir: string,
  stream: string,
  retention: number
): void => {
  if (retention <= 1) {
    rmSync(streamFilePath(logDir, stream), { force: true });
    return;
  }

  const maxArchiveIndex = retention - 1;
  rmSync(rotationFilePath(logDir, stream, maxArchiveIndex), { force: true });

  for (let index = maxArchiveIndex - 1; index >= 1; index -= 1) {
    const source = rotationFilePath(logDir, stream, index);
    if (!existsSync(source)) {
      continue;
    }
    const target = rotationFilePath(logDir, stream, index + 1);
    renameSync(source, target);
  }

  const current = streamFilePath(logDir, stream);
  if (existsSync(current)) {
    renameSync(current, rotationFilePath(logDir, stream, 1));
  }
};

const rotateIfNeeded = (state: LoggerState, pendingLine: string): void => {
  if (!existsSync(state.filePath)) {
    return;
  }

  const pendingBytes = Buffer.byteLength(pendingLine, 'utf8');
  const currentSize = statSync(state.filePath).size;
  if (currentSize + pendingBytes <= state.maxBytes) {
    return;
  }

  rotateStreamFiles(state.logDir, state.stream, state.retention);
};

const buildLogger = (state: LoggerState, bindings: LogFields): JsonlLogger => {
  const log = (
    level: LogLevel,
    event: string,
    fields: LogFields = {}
  ): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[state.level]) {
      return;
    }

    const payload = {
      ts: state.now().toISOString(),
      level,
      stream: state.stream,
      event,
      ...bindings,
      ...fields,
    };

    const normalized = normalizeForJson(payload, new WeakSet<object>());
    const redacted = redactJson(normalized, state.redactKeys);
    const line = `${JSON.stringify(redacted)}\n`;

    try {
      rotateIfNeeded(state, line);
      appendFileSync(state.filePath, line, 'utf8');
    } catch {
      // Logging should not break request flows.
    }
  };

  return {
    stream: state.stream,
    level: state.level,
    logDir: state.logDir,
    filePath: state.filePath,
    child: (childBindings) =>
      buildLogger(state, {
        ...bindings,
        ...childBindings,
      }),
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
};

export const createJsonlLogger = (options: JsonlLoggerOptions): JsonlLogger => {
  const stream = sanitizeStreamName(options.stream);
  const logDir = resolveLogDirectory({
    cwd: options.cwd,
    gitRoot: options.gitRoot,
    logDir: options.logDir,
  });

  mkdirSync(logDir, { recursive: true });

  const maxBytes =
    typeof options.maxBytes === 'number' && options.maxBytes > 0
      ? Math.floor(options.maxBytes)
      : DEFAULT_LOG_ROTATION_MAX_BYTES;

  const retention =
    typeof options.retention === 'number' && options.retention > 0
      ? Math.max(1, Math.floor(options.retention))
      : DEFAULT_LOG_RETENTION;

  const state: LoggerState = {
    stream,
    level: options.level ?? 'debug',
    logDir,
    filePath: streamFilePath(logDir, stream),
    maxBytes,
    retention,
    redactKeys: new Set(
      (options.redactKeys ?? DEFAULT_REDACT_KEYS).map(normalizeRedactionKey)
    ),
    now: options.now ?? (() => new Date()),
  };

  return buildLogger(state, options.bindings ?? {});
};
