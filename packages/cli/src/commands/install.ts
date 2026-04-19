import { Command } from 'commander';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runLocal } from '../cli-runtime';
import { checkboxPrompt, requireTty } from '../tui';
import {
  getDefaultHarnessTargets,
  HarnessId,
} from '../installer/harness-targets';
import {
  resolveSkillSourceDir,
  readCliPackageVersion,
} from '../installer/package-info';
import { installBrowserBridgeSkill } from '../installer/skill-install';
import { installMcp } from '../installer/mcp-install';

type SetupItem = 'skill' | 'mcp';

type HarnessInstallResult = {
  harness: HarnessId;
  skill?: { ok: true; destDir: string };
  mcp?:
    | { ok: true; details?: { cursorSettingsPath?: string } }
    | { ok: false; error: { code: string; message: string } };
};

const formatInstallSummary = (options: {
  setup: SetupItem[];
  results: HarnessInstallResult[];
}): string => {
  const wantsSkill = options.setup.includes('skill');
  const wantsMcp = options.setup.includes('mcp');

  const lines: string[] = [];

  if (wantsSkill) {
    const skillInstalled = options.results
      .filter((r) => r.skill?.ok)
      .map((r) => `- ${r.harness}: ${r.skill?.destDir ?? ''}`);
    if (skillInstalled.length > 0) {
      lines.push('Skill installed:');
      lines.push(...skillInstalled);
      lines.push('');
    }
  }

  if (wantsMcp) {
    const mcpOk = options.results
      .filter((r) => r.mcp?.ok)
      .map((r) => `- ${r.harness}`);

    const mcpFailed = options.results
      .filter((r) => r.mcp && r.mcp.ok === false)
      .map((r) =>
        r.mcp && r.mcp.ok === false
          ? `- ${r.harness}: ${r.mcp.error.message}`
          : `- ${r.harness}: unknown error`
      );

    if (mcpOk.length > 0) {
      lines.push('MCP installed:');
      lines.push(...mcpOk);
      lines.push('');
    }

    if (mcpFailed.length > 0) {
      lines.push('MCP failed:');
      lines.push(...mcpFailed);
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
};

const getHarnessMarkerDir = (harness: HarnessId): string => {
  const homeDir = os.homedir();
  switch (harness) {
    case 'codex':
      return path.join(homeDir, '.agents');
    default:
      return path.join(homeDir, `.${harness}`);
  }
};

export const registerInstallCommand = (program: Command): void => {
  program
    .command('install')
    .description(
      'Install legacy Browser Bridge integrations (deprecated; prefer Codex browser plugin, agent-browser, or Playwright MCP)'
    )
    .action(async (_options, command: Command) => {
      await runLocal(command, async ({ json }) => {
        if (json) {
          throw new Error('install is interactive; omit --json.');
        }

        requireTty();

        console.log('Browser Bridge Installer (Deprecated)');
        console.log(
          "Prefer Codex's browser plugin. If you need an external option, use agent-browser (https://agent-browser.io/) or Playwright MCP (https://github.com/microsoft/playwright-mcp)."
        );

        const setup = await checkboxPrompt<SetupItem>({
          message: "Choose what you'd like to install:",
          choices: [
            { value: 'skill', label: 'Skill (Recommended)', checked: true },
            { value: 'mcp', label: 'MCP (Optional)', checked: true },
          ],
        });

        if (setup.length === 0) {
          return { ok: true, result: 'No changes (nothing selected).' };
        }

        const wantsSkill = setup.includes('skill');
        const wantsMcp = setup.includes('mcp');

        const targets = getDefaultHarnessTargets();

        // Default to harnesses whose home dirs exist, otherwise select Codex.
        const checked = new Set<HarnessId>();
        for (const t of targets) {
          try {
            await fs.stat(getHarnessMarkerDir(t.id));
            checked.add(t.id);
          } catch {
            // ignore
          }
        }
        if (checked.size === 0) {
          checked.add('codex');
        }

        const selected = await checkboxPrompt<HarnessId>({
          message: 'Install into clients:',
          choices: targets.map((t) => {
            const mcpCapable = t.supportsMcpInstall;
            const enabled = wantsSkill || mcpCapable;
            const disabled = enabled
              ? false
              : wantsMcp
                ? 'MCP install not supported yet'
                : false;

            // Keep labels minimal: only annotate when the row is "skill only"
            // while the user selected Skill+MCP.
            const suffix =
              wantsMcp && wantsSkill && !mcpCapable ? ' (skill only)' : '';

            return {
              value: t.id,
              label: `${t.label}${suffix}`,
              checked: checked.has(t.id),
              disabled,
            };
          }),
        });

        const version = await readCliPackageVersion();
        const srcSkillDir = await resolveSkillSourceDir();
        const byId = new Map(targets.map((t) => [t.id, t]));

        const results: HarnessInstallResult[] = [];
        let hadError = false;
        for (const harness of selected) {
          const t = byId.get(harness);
          if (!t) continue;

          const row: HarnessInstallResult = { harness };

          if (wantsSkill) {
            const installed = await installBrowserBridgeSkill({
              srcSkillDir,
              destSkillsDir: t.skillsDir,
              version,
            });
            row.skill = { ok: true, destDir: installed.destDir };
          }

          if (wantsMcp && t.supportsMcpInstall) {
            // Only Codex/Claude/Cursor supported in v1.
            if (
              harness === 'codex' ||
              harness === 'claude' ||
              harness === 'cursor'
            ) {
              row.mcp = await installMcp(harness);
              if (row.mcp.ok === false) {
                hadError = true;
              }
            }
          }

          results.push(row);
        }

        if (hadError) {
          process.exitCode = 1;
        }

        const summary = formatInstallSummary({ setup, results });
        return { ok: true, result: summary || 'Done.' };
      });
    });
};
