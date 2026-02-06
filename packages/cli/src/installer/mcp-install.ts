import { spawn } from 'node:child_process';
import { installCursorMcp } from './cursor-mcp';

export type McpHarnessId = 'codex' | 'claude' | 'cursor';

export type McpInstallResult =
  | { ok: true; details?: { cursorSettingsPath?: string } }
  | { ok: false; error: { code: string; message: string } };

const runQuiet = async (cmd: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : '';
        reject(new Error(`${cmd} exited with ${code ?? 'unknown'}${suffix}`));
      }
    });
  });
};

const tryRun = async (cmd: string, args: string[]): Promise<void> => {
  try {
    await runQuiet(cmd, args);
  } catch {
    // best-effort (used for remove)
  }
};

export const installMcp = async (
  harness: McpHarnessId
): Promise<McpInstallResult> => {
  try {
    if (harness === 'codex') {
      await tryRun('codex', ['mcp', 'remove', 'browser-bridge']);
      await runQuiet('codex', [
        'mcp',
        'add',
        'browser-bridge',
        '--',
        'browser-bridge',
        'mcp',
      ]);
      return { ok: true };
    }

    if (harness === 'claude') {
      // Remove any existing config, then install user-scoped so it "just works" across projects.
      await tryRun('claude', [
        'mcp',
        'remove',
        '--scope',
        'local',
        'browser-bridge',
      ]);
      await tryRun('claude', [
        'mcp',
        'remove',
        '--scope',
        'project',
        'browser-bridge',
      ]);
      await tryRun('claude', [
        'mcp',
        'remove',
        '--scope',
        'user',
        'browser-bridge',
      ]);

      await runQuiet('claude', [
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'stdio',
        'browser-bridge',
        '--',
        'browser-bridge',
        'mcp',
      ]);
      return { ok: true };
    }

    // Cursor supports `--add-mcp`, but in practice its argv parsing breaks when
    // passing JSON that includes commas (it gets split and stops being valid
    // JSON). Install by directly updating Cursor's user settings instead.
    const cursor = await installCursorMcp();
    return { ok: true, details: { cursorSettingsPath: cursor.settingsPath } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return {
      ok: false,
      error: { code: 'MCP_INSTALL_FAILED', message },
    };
  }
};
