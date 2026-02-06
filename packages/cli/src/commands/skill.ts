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
import { readSkillManifest } from '../installer/skill-manifest';

const getHarnessMarkerDir = (homeDir: string, harness: HarnessId): string => {
  switch (harness) {
    case 'codex':
      return path.join(homeDir, '.agents');
    default:
      return path.join(homeDir, `.${harness}`);
  }
};

type SkillStatusRow = {
  harness: HarnessId;
  skillsDir: string;
  installed: boolean;
  installedVersion: string | null;
  expectedVersion: string;
  upToDate: boolean;
};

export const registerSkillCommands = (program: Command): void => {
  const skill = program.command('skill').description('Skill commands');

  skill
    .command('install')
    .description('Install the Browser Bridge skill into one or more clients')
    .option(
      '--client <id...>',
      'Client ids to install into (codex, claude, cursor, factory, opencode, gemini, github, ampcode)'
    )
    .option('--harness <id...>', 'Alias for --client')
    .action(
      async (
        options: { client?: string[]; harness?: string[] },
        command: Command
      ) => {
        await runLocal(command, async ({ json }) => {
          if (json) {
            throw new Error('skill install is interactive; omit --json.');
          }

          const version = await readCliPackageVersion();
          const srcSkillDir = await resolveSkillSourceDir();

          const targets = getDefaultHarnessTargets();
          const byId = new Map(targets.map((t) => [t.id, t]));

          let selected: HarnessId[];
          const requested = options.client?.length
            ? options.client
            : options.harness;

          if (requested && requested.length > 0) {
            selected = requested.map((id) => {
              if (!byId.has(id as HarnessId)) {
                throw new Error(`Unknown client: ${id}`);
              }
              return id as HarnessId;
            });
          } else {
            requireTty();

            // Default to clients whose home dirs exist, otherwise select Codex.
            const homeDir = os.homedir();

            const checked = new Set<HarnessId>();
            for (const t of targets) {
              try {
                const marker = getHarnessMarkerDir(homeDir, t.id);
                await fs.stat(marker);
                checked.add(t.id);
              } catch {
                // ignore
              }
            }
            if (checked.size === 0) {
              checked.add('codex');
            }

            selected = await checkboxPrompt<HarnessId>({
              message: 'Install Browser Bridge skill into clients:',
              choices: targets.map((t) => ({
                value: t.id,
                label: `${t.label} (${t.skillsDir})`,
                checked: checked.has(t.id),
              })),
            });
          }

          const results: Record<string, { destDir: string }> = {};
          for (const client of selected) {
            const target = byId.get(client);
            if (!target) continue;
            const installed = await installBrowserBridgeSkill({
              srcSkillDir,
              destSkillsDir: target.skillsDir,
              version,
            });
            results[client] = { destDir: installed.destDir };
          }

          return {
            ok: true,
            result: {
              version,
              installed: results,
            },
          };
        });
      }
    );

  skill
    .command('status')
    .description('Show Browser Bridge skill install status across clients')
    .action(async (_options, command: Command) => {
      await runLocal(command, async () => {
        const version = await readCliPackageVersion();
        const targets = getDefaultHarnessTargets();

        const rows: SkillStatusRow[] = [];
        for (const t of targets) {
          const skillDir = path.join(t.skillsDir, 'browser-bridge');
          let installed = false;
          try {
            await fs.stat(skillDir);
            installed = true;
          } catch {
            installed = false;
          }

          const manifest = installed ? await readSkillManifest(skillDir) : null;
          const installedVersion = manifest?.version ?? null;
          const upToDate = installedVersion === version;

          rows.push({
            harness: t.id,
            skillsDir: t.skillsDir,
            installed,
            installedVersion,
            expectedVersion: version,
            upToDate,
          });
        }

        return { ok: true, result: { rows } };
      });
    });
};
