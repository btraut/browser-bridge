import { Command } from 'commander';
import { registerArtifactsCommands } from './commands/artifacts';
import { registerDialogCommands } from './commands/dialog';
import { registerDiagnosticsCommands } from './commands/diagnostics';
import { registerDriveCommands } from './commands/drive';
import { registerInspectCommands } from './commands/inspect';
import { registerMcpCommand } from './commands/mcp';
import { registerOpenArtifactsCommand } from './commands/open-artifacts';
import { registerSessionCommands } from './commands/session';
import { registerSkillCommands } from './commands/skill';
import { registerInstallCommand } from './commands/install';

const program = new Command();

program
  .name('browser-bridge')
  .description('Browser Bridge CLI')
  .option('--host <host>', 'Core host (default: 127.0.0.1)')
  .option('--port <port>', 'Core port (default: 3210)')
  .option('--json', 'Output JSON')
  .option('--no-daemon', 'Disable auto-starting Core');

registerSessionCommands(program);
registerDriveCommands(program);
registerInspectCommands(program);
registerArtifactsCommands(program);
registerDiagnosticsCommands(program);
registerDialogCommands(program);
registerOpenArtifactsCommand(program);
registerMcpCommand(program);
registerSkillCommands(program);
registerInstallCommand(program);

void program.parseAsync(process.argv);
