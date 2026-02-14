import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonlLogger } from './logging';

const trackedTempDirs: string[] = [];

const createTempDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedTempDirs.push(dir);
  return dir;
};

const createGitRoot = (prefix: string): string => {
  const root = createTempDir(prefix);
  mkdirSync(path.join(root, '.git'), { recursive: true });
  return root;
};

afterEach(() => {
  while (trackedTempDirs.length > 0) {
    const dir = trackedTempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('logging', () => {
  it('writes structured JSONL lines with redaction in the default worktree log dir', () => {
    const root = createGitRoot('logging-default-dir-');
    const nested = path.join(root, 'nested', 'cwd');
    mkdirSync(nested, { recursive: true });

    const logger = createJsonlLogger({
      stream: 'core',
      cwd: nested,
      bindings: { component: 'core' },
    });

    logger.info('core.startup', {
      token: 'abc123',
      password: 'hunter2',
      nested: { authorization: 'Bearer test-token' },
      safe: 'value',
    });

    expect(logger.filePath).toBe(
      path.join(root, '.context', 'logs', 'browser-bridge', 'core.jsonl')
    );

    const raw = readFileSync(logger.filePath, 'utf8').trim();
    const line = JSON.parse(raw) as Record<string, unknown>;

    expect(line.event).toBe('core.startup');
    expect(line.component).toBe('core');
    expect(line.token).toBe('[REDACTED]');
    expect(line.password).toBe('[REDACTED]');
    expect(line.safe).toBe('value');
    expect(line.nested).toEqual({ authorization: '[REDACTED]' });
  });

  it('rotates log streams when max size is exceeded and enforces retention', () => {
    const root = createGitRoot('logging-rotation-');
    const logger = createJsonlLogger({
      stream: 'cli',
      cwd: root,
      maxBytes: 240,
      retention: 3,
    });

    for (let index = 0; index < 8; index += 1) {
      logger.info('cli.command', {
        index,
        blob: 'x'.repeat(120),
      });
    }

    const files = readdirSync(logger.logDir)
      .filter((entry) => entry.startsWith('cli'))
      .sort();

    expect(files).toEqual(['cli.1.jsonl', 'cli.2.jsonl', 'cli.jsonl']);

    const latestLine = readFileSync(
      path.join(logger.logDir, 'cli.jsonl'),
      'utf8'
    )
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    const lastEntry =
      latestLine.length > 0 ? latestLine[latestLine.length - 1] : undefined;

    expect(lastEntry).toBeTruthy();
    expect(JSON.parse(lastEntry ?? '{}')).toEqual(
      expect.objectContaining({ index: 7, event: 'cli.command' })
    );
  });

  it('isolates stream files per component in the same log directory', () => {
    const root = createGitRoot('logging-streams-');
    const logDir = path.join(root, '.context', 'logs', 'browser-bridge');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, 'existing.txt'), 'ignore', 'utf8');

    const coreLogger = createJsonlLogger({ stream: 'core', cwd: root });
    const mcpLogger = createJsonlLogger({ stream: 'mcp-adapter', cwd: root });

    coreLogger.info('core.event', { ok: true });
    mcpLogger.info('mcp.event', { ok: true });

    const files = readdirSync(logDir).sort();
    expect(files).toContain('core.jsonl');
    expect(files).toContain('mcp-adapter.jsonl');
    expect(files).toContain('existing.txt');
  });
});
