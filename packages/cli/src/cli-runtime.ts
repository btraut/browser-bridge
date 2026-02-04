import { Command } from "commander";
import { ApiEnvelope } from "@browser-vision/shared";
import { createCoreClient, CoreClient } from "./core-client";
import { outputEnvelope, outputError } from "./cli-output";

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

export const createClientFromCommand = (command: Command): CoreClient => {
  const options = getGlobalOptions(command);
  return createCoreClient({
    host: options.host,
    port: options.port,
    ensureDaemon: options.daemon !== false,
  });
};

export const runCommand = async <T>(
  command: Command,
  work: (client: CoreClient, options: GlobalOptions) => Promise<ApiEnvelope<T>>
): Promise<void> => {
  const options = getGlobalOptions(command);
  const client = createClientFromCommand(command);

  try {
    const envelope = await work(client, options);
    outputEnvelope(envelope, { json: Boolean(options.json) });
    if (!envelope.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    outputError(error, { json: Boolean(options.json) });
    process.exitCode = 1;
  }
};

export const runLocal = async (
  command: Command,
  work: (options: GlobalOptions) => Promise<ApiEnvelope<unknown>>
): Promise<void> => {
  const options = getGlobalOptions(command);

  try {
    const envelope = await work(options);
    outputEnvelope(envelope, { json: Boolean(options.json) });
    if (!envelope.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    outputError(error, { json: Boolean(options.json) });
    process.exitCode = 1;
  }
};
