import { Command } from 'commander';
import {
  ApiEnvelope,
  JsonlLogger,
  createJsonlLogger,
} from '@btraut/browser-bridge-shared';
import { createCoreClient, CoreClient } from './core-client';
import { outputEnvelope, outputError } from './cli-output';

type GlobalOptions = {
  host?: string;
  port?: number | string;
  json?: boolean;
  daemon?: boolean;
};

const getRootCommand = (command: Command): Command => {
  let current: Command = command;
  while (current.parent) {
    current = current.parent;
  }
  return current;
};

export const getGlobalOptions = (command: Command): GlobalOptions => {
  const root = getRootCommand(command);
  return root.opts<GlobalOptions>();
};

const durationMs = (startedAt: bigint): number =>
  Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));

const commandLabel = (command: Command): string => {
  const pieces = command
    .name()
    .split(' ')
    .filter((piece) => piece.length > 0);
  return pieces.length > 0 ? pieces.join('.') : 'unknown';
};

const createCliLogger = (command: Command): JsonlLogger =>
  createJsonlLogger({ stream: 'cli' }).child({
    scope: 'cli-runtime',
    command: commandLabel(command),
  });

export const createClientFromCommand = (
  command: Command,
  logger?: JsonlLogger
): CoreClient => {
  const options = getGlobalOptions(command);
  return createCoreClient({
    host: options.host,
    port: options.port,
    ensureDaemon: options.daemon !== false,
    logger: logger?.child({ scope: 'core-client' }),
  });
};

export const runCommand = async <T>(
  command: Command,
  work: (client: CoreClient, options: GlobalOptions) => Promise<ApiEnvelope<T>>
): Promise<void> => {
  const options = getGlobalOptions(command);
  const logger = createCliLogger(command);
  const startedAt = process.hrtime.bigint();
  logger.info('cli.command.start', {
    host: options.host ?? null,
    port: options.port ?? null,
    daemon: options.daemon !== false,
    json: Boolean(options.json),
  });
  const client = createClientFromCommand(command, logger);

  try {
    const envelope = await work(client, options);
    outputEnvelope(envelope, { json: Boolean(options.json) });
    logger.info('cli.command.end', {
      ok: envelope.ok,
      duration_ms: durationMs(startedAt),
    });
    if (!envelope.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error('cli.command.error', {
      duration_ms: durationMs(startedAt),
      error,
    });
    outputError(error, { json: Boolean(options.json) });
    process.exitCode = 1;
  }
};

export const runLocal = async (
  command: Command,
  work: (options: GlobalOptions) => Promise<ApiEnvelope<unknown>>
): Promise<void> => {
  const options = getGlobalOptions(command);
  const logger = createCliLogger(command).child({ mode: 'local' });
  const startedAt = process.hrtime.bigint();
  logger.info('cli.command.start', {
    json: Boolean(options.json),
  });

  try {
    const envelope = await work(options);
    outputEnvelope(envelope, { json: Boolean(options.json) });
    logger.info('cli.command.end', {
      ok: envelope.ok,
      duration_ms: durationMs(startedAt),
    });
    if (!envelope.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error('cli.command.error', {
      duration_ms: durationMs(startedAt),
      error,
    });
    outputError(error, { json: Boolean(options.json) });
    process.exitCode = 1;
  }
};
