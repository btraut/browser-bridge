import { Command } from 'commander';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createServer } from 'node:http';
import { CLI_TOOL_FIXTURES } from '../tool-fixtures';
import { runCommand } from '../cli-runtime';

const coreFixtures = CLI_TOOL_FIXTURES.filter(
  (fixture) => fixture.kind === 'core'
);

type MockServerState = {
  port: number;
  errorPath: string | null;
};

const startMockCore = async (): Promise<{
  state: MockServerState;
  stop: () => Promise<void>;
}> => {
  const state: MockServerState = {
    port: 0,
    errorPath: null,
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      const body = bodyRaw ? JSON.parse(bodyRaw) : undefined;
      const path = req.url ?? '';

      const payload =
        state.errorPath && path === state.errorPath
          ? {
              ok: false,
              error: {
                code: 'INTERNAL',
                message: 'Mock error',
                retryable: false,
              },
            }
          : {
              ok: true,
              result: {
                path,
                received: body,
              },
            };

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        state.port = address.port;
      }
      resolve();
    });
  });

  return {
    state,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
};

const buildCommand = (port: number): Command => {
  const command = new Command();
  const opts = () => ({
    host: '127.0.0.1',
    port,
    json: true,
    daemon: false,
  });
  command.opts = opts as Command['opts'];
  return command;
};

describe('cli integration (mock core)', () => {
  let state: MockServerState;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await startMockCore();
    state = server.state;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(() => {
    state.errorPath = null;
    process.exitCode = undefined;
  });

  it('forwards requests and prints JSON output', async () => {
    for (const fixture of coreFixtures) {
      const logSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);

      const command = buildCommand(state.port);
      await runCommand(command, (client) =>
        client.post(fixture.corePath ?? '', fixture.payload)
      );

      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? '')) as {
        ok: boolean;
        result?: { path: string; received: unknown };
      };

      expect(output.ok).toBe(true);
      expect(output.result?.path).toBe(fixture.corePath);
      if (fixture.corePath === '/diagnostics/doctor') {
        expect(output.result?.received).toEqual(
          expect.objectContaining(fixture.payload as Record<string, unknown>)
        );
        expect(
          (
            output.result?.received as {
              caller?: { process?: { component?: string } };
            }
          ).caller?.process?.component
        ).toBe('cli');
      } else {
        expect(output.result?.received).toEqual(fixture.payload);
      }
      expect(process.exitCode).toBeUndefined();

      logSpy.mockRestore();
    }
  });

  it('sets exit code on error envelopes', async () => {
    const fixture = coreFixtures[0];
    state.errorPath = fixture.corePath ?? null;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const command = buildCommand(state.port);
    await runCommand(command, (client) =>
      client.post(fixture.corePath ?? '', fixture.payload)
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? '')) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(output.ok).toBe(false);
    expect(output.error?.code).toBe('INTERNAL');
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
  });
});
