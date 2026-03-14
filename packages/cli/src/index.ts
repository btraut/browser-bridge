#!/usr/bin/env node

import { Command } from 'commander';
import { registerArtifactsCommands } from './commands/artifacts';
import { registerDialogCommands } from './commands/dialog';
import { registerDiagnosticsCommands } from './commands/diagnostics';
import { registerDevCommands } from './commands/dev';
import { registerDriveCommands } from './commands/drive';
import { registerInspectCommands } from './commands/inspect';
import { registerMcpCommand } from './commands/mcp';
import { registerOpenArtifactsCommand } from './commands/open-artifacts';
import { registerPermissionsCommands } from './commands/permissions';
import { registerSessionCommands } from './commands/session';
import { registerSkillCommands } from './commands/skill';
import { registerInstallCommand } from './commands/install';
import { readCliPackageVersion } from './installer/package-info';

const program = new Command();

const resolveCliVersion = async (): Promise<string> => {
  try {
    return await readCliPackageVersion();
  } catch {
    return '0.0.0-unknown';
  }
};

const main = async (): Promise<void> => {
  program
    .name('browser-bridge')
    .description('Browser Bridge CLI')
    .version(
      await resolveCliVersion(),
      '-v, --version',
      'Output Browser Bridge CLI version'
    )
    .option('--host <host>', 'Core host (default: 127.0.0.1)')
    .option('--port <port>', 'Core port (default: 3210)')
    .option('--json', 'Output JSON')
    .option('--no-daemon', 'Disable auto-starting Core');

  registerSessionCommands(program);
  registerPermissionsCommands(program);
  registerDriveCommands(program);
  registerInspectCommands(program);
  registerArtifactsCommands(program);
  registerDiagnosticsCommands(program);
  registerDialogCommands(program);
  registerDevCommands(program);
  registerOpenArtifactsCommand(program);
  registerMcpCommand(program);
  registerSkillCommands(program);
  registerInstallCommand(program);

  await program.parseAsync(process.argv);
};

void main();
