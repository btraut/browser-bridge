import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLI_TOOL_FIXTURES } from '../tool-fixtures';
import { registerArtifactsCommands } from './artifacts';
import { registerDiagnosticsCommands } from './diagnostics';
import { registerDialogCommands } from './dialog';
import { registerDriveCommands } from './drive';
import { registerInspectCommands } from './inspect';
import { registerOpenArtifactsCommand } from './open-artifacts';
import { registerSessionCommands } from './session';
import { runCommand } from '../cli-runtime';

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

  registerSessionCommands(program);
  registerDriveCommands(program);
  registerInspectCommands(program);
  registerArtifactsCommands(program);
  registerDiagnosticsCommands(program);
  registerDialogCommands(program);
  registerOpenArtifactsCommand(program);

  program.exitOverride();

  return program;
};

type PostCall = [string, unknown];

const runFixture = async (argv: string[]): Promise<PostCall> => {
  const post = vi.fn(async () => ({ ok: true, result: {} }));

  const runCommandMock = vi.mocked(runCommand);
  runCommandMock.mockImplementation(async (_command, work) => {
    await work({ post } as { post: typeof post }, {});
  });

  const program = buildProgram();
  await program.parseAsync(['node', 'cli', ...argv]);

  expect(runCommandMock).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledTimes(1);

  return post.mock.calls[0] as PostCall;
};

describe('cli command payload shaping', () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockReset();
  });

  for (const fixture of CLI_TOOL_FIXTURES.filter(
    (entry) => entry.kind === 'core'
  )) {
    it(`maps ${fixture.name}`, async () => {
      const [path, payload] = await runFixture(fixture.argv);
      expect(path).toBe(fixture.corePath);
      expect(payload).toEqual(fixture.payload);
    });
  }
});
