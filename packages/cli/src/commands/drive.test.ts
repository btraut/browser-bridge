import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDriveCommands } from './drive';
import { runCommand } from '../cli-runtime';
import type { CoreClient } from '../core-client';

vi.mock('../cli-runtime', () => ({
  runCommand: vi.fn(),
}));

const buildProgram = (): Command => {
  const program = new Command();
  program
    .option('--host <host>')
    .option('--port <port>')
    .option('--json')
    .option('--no-daemon');
  registerDriveCommands(program);
  program.exitOverride();
  return program;
};

describe('drive navigate command', () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockReset();
  });

  it('advertises networkidle as a supported wait mode', () => {
    const program = buildProgram();
    const drive = program.commands.find(
      (command) => command.name() === 'drive'
    );
    const navigate = drive?.commands.find(
      (command) => command.name() === 'navigate'
    );
    const waitOption = navigate?.options.find(
      (option) => option.long === '--wait'
    );

    expect(waitOption?.description).toContain('networkidle');
  });

  it('forwards drive.navigate without session_id when omitted', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true as const,
      result: { ok: true, session_id: 'session-auto' },
    });

    const client = {
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: async () => undefined,
      post,
    } as CoreClient;

    vi.mocked(runCommand).mockImplementation(async (_command, work) => {
      await work(client, {});
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'drive',
      'navigate',
      '--url',
      'https://example.com',
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/drive/navigate', {
      url: 'https://example.com',
      wait: 'domcontentloaded',
    });
  });

  it('forwards drive.navigate with an explicit --session-id', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true as const,
      result: { ok: true },
    });

    const client = {
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: async () => undefined,
      post,
    } as CoreClient;

    vi.mocked(runCommand).mockImplementation(async (_command, work) => {
      await work(client, {});
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'drive',
      'navigate',
      '--session-id',
      'session-1',
      '--url',
      'https://example.com',
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/drive/navigate', {
      session_id: 'session-1',
      url: 'https://example.com',
      wait: 'domcontentloaded',
    });
  });

  it('routes deprecated drive back alias to canonical core path', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true as const,
      result: { ok: true },
    });

    const client = {
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: async () => undefined,
      post,
    } as CoreClient;

    vi.mocked(runCommand).mockImplementation(async (_command, work) => {
      await work(client, {});
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'drive',
      'back',
      '--session-id',
      'session-1',
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/drive/go_back', {
      session_id: 'session-1',
      tab_id: undefined,
    });
  });

  it('routes deprecated drive forward alias to canonical core path', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true as const,
      result: { ok: true },
    });

    const client = {
      baseUrl: 'http://127.0.0.1:3210',
      ensureReady: async () => undefined,
      post,
    } as CoreClient;

    vi.mocked(runCommand).mockImplementation(async (_command, work) => {
      await work(client, {});
    });

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'drive',
      'forward',
      '--session-id',
      'session-1',
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/drive/go_forward', {
      session_id: 'session-1',
      tab_id: undefined,
    });
  });
});
