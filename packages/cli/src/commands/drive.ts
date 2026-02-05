import { Command } from 'commander';
import {
  DriveClickInputSchema,
  DriveDragInputSchema,
  DriveFillFormInputSchema,
  DriveBackInputSchema,
  DriveForwardInputSchema,
  DriveGoBackInputSchema,
  DriveGoForwardInputSchema,
  DriveHandleDialogInputSchema,
  DriveHoverInputSchema,
  DriveSelectInputSchema,
  DriveKeyInputSchema,
  DriveKeyPressInputSchema,
  DriveNavigateInputSchema,
  DriveScrollInputSchema,
  DriveTabActivateInputSchema,
  DriveTabCloseInputSchema,
  DriveTabListInputSchema,
  DriveTypeInputSchema,
  DriveWaitForInputSchema,
} from '@browser-vision/shared';
import { parseInput } from '../cli-output';
import { runCommand } from '../cli-runtime';
import { buildLocator, requireLocator } from '../locator';

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
};

export const registerDriveCommands = (program: Command): void => {
  const drive = program.command('drive').description('Drive commands');

  drive
    .command('navigate')
    .description('Navigate to a URL')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--url <url>', 'URL to navigate to')
    .option('--wait <mode>', 'Wait mode (none, domcontentloaded)')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveNavigateInputSchema, {
          session_id: options.sessionId,
          url: options.url,
          wait: options.wait,
        });
        return client.post('/drive/navigate', payload);
      });
    });

  drive
    .command('go-back')
    .description('Go back in browser history')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveGoBackInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/go_back', payload);
      });
    });

  drive
    .command('back')
    .description('Go back in browser history')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveBackInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/back', payload);
      });
    });

  drive
    .command('go-forward')
    .description('Go forward in browser history')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveGoForwardInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/go_forward', payload);
      });
    });

  drive
    .command('forward')
    .description('Go forward in browser history')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveForwardInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/forward', payload);
      });
    });

  drive
    .command('click')
    .description('Click an element')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--locator-ref <ref>', 'Locator ref (e.g., @e1)')
    .option('--locator-testid <id>', 'Locator test id')
    .option('--locator-css <selector>', 'Locator CSS selector')
    .option('--locator-text <text>', 'Locator text')
    .option('--locator-role <role>', 'Locator role name')
    .option('--locator-role-value <value>', 'Locator role value')
    .option('--click-count <count>', 'Click count')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const locator = requireLocator({
          locatorRef: options.locatorRef,
          locatorTestid: options.locatorTestid,
          locatorCss: options.locatorCss,
          locatorText: options.locatorText,
          locatorRole: options.locatorRole,
          locatorRoleValue: options.locatorRoleValue,
        });
        const payload = parseInput(DriveClickInputSchema, {
          session_id: options.sessionId,
          locator,
          click_count: parseNumber(options.clickCount),
        });
        return client.post('/drive/click', payload);
      });
    });

  drive
    .command('hover')
    .description('Hover over an element')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--locator-ref <ref>', 'Locator ref (e.g., @e1)')
    .option('--locator-testid <id>', 'Locator test id')
    .option('--locator-css <selector>', 'Locator CSS selector')
    .option('--locator-text <text>', 'Locator text')
    .option('--locator-role <role>', 'Locator role name')
    .option('--locator-role-value <value>', 'Locator role value')
    .option('--delay-ms <ms>', 'Delay after hover in milliseconds')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const locator = requireLocator({
          locatorRef: options.locatorRef,
          locatorTestid: options.locatorTestid,
          locatorCss: options.locatorCss,
          locatorText: options.locatorText,
          locatorRole: options.locatorRole,
          locatorRoleValue: options.locatorRoleValue,
        });
        const payload = parseInput(DriveHoverInputSchema, {
          session_id: options.sessionId,
          locator,
          delay_ms: parseNumber(options.delayMs),
        });
        return client.post('/drive/hover', payload);
      });
    });

  drive
    .command('select')
    .description('Select an option in a dropdown')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--locator-ref <ref>', 'Locator ref (e.g., @e1)')
    .option('--locator-testid <id>', 'Locator test id')
    .option('--locator-css <selector>', 'Locator CSS selector')
    .option('--locator-text <text>', 'Locator text')
    .option('--locator-role <role>', 'Locator role name')
    .option('--locator-role-value <value>', 'Locator role value')
    .option('--value <value>', 'Option value attribute')
    .option('--text <text>', 'Option visible text')
    .option('--index <index>', 'Option index (0-based)')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const locator = requireLocator({
          locatorRef: options.locatorRef,
          locatorTestid: options.locatorTestid,
          locatorCss: options.locatorCss,
          locatorText: options.locatorText,
          locatorRole: options.locatorRole,
          locatorRoleValue: options.locatorRoleValue,
        });
        const payload = parseInput(DriveSelectInputSchema, {
          session_id: options.sessionId,
          locator,
          value: options.value,
          text: options.text,
          index: parseNumber(options.index),
        });
        return client.post('/drive/select', payload);
      });
    });

  drive
    .command('type')
    .description('Type into a field')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--text <text>', 'Text to enter')
    .option('--locator-ref <ref>', 'Locator ref (e.g., @e1)')
    .option('--locator-testid <id>', 'Locator test id')
    .option('--locator-css <selector>', 'Locator CSS selector')
    .option('--locator-text <text>', 'Locator text')
    .option('--locator-role <role>', 'Locator role name')
    .option('--locator-role-value <value>', 'Locator role value')
    .option('--clear', 'Clear input before typing')
    .option('--submit', 'Submit after typing')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const locator = buildLocator({
          locatorRef: options.locatorRef,
          locatorTestid: options.locatorTestid,
          locatorCss: options.locatorCss,
          locatorText: options.locatorText,
          locatorRole: options.locatorRole,
          locatorRoleValue: options.locatorRoleValue,
        });
        const payload = parseInput(DriveTypeInputSchema, {
          session_id: options.sessionId,
          locator,
          text: options.text,
          clear: Boolean(options.clear),
          submit: Boolean(options.submit),
        });
        return client.post('/drive/type', payload);
      });
    });

  drive
    .command('fill-form')
    .description('Fill multiple form fields')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--fields <json>', 'JSON array of fields to fill')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const fields = parseJson(options.fields, 'fields');
        const payload = parseInput(DriveFillFormInputSchema, {
          session_id: options.sessionId,
          fields,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/fill_form', payload);
      });
    });

  drive
    .command('drag')
    .description('Drag an element to a target')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--from-locator-ref <ref>', 'Source locator ref (e.g., @e1)')
    .option('--from-locator-testid <id>', 'Source locator test id')
    .option('--from-locator-css <selector>', 'Source locator CSS selector')
    .option('--from-locator-text <text>', 'Source locator text')
    .option('--from-locator-role <role>', 'Source locator role name')
    .option('--from-locator-role-value <value>', 'Source locator role value')
    .option('--to-locator-ref <ref>', 'Target locator ref (e.g., @e1)')
    .option('--to-locator-testid <id>', 'Target locator test id')
    .option('--to-locator-css <selector>', 'Target locator CSS selector')
    .option('--to-locator-text <text>', 'Target locator text')
    .option('--to-locator-role <role>', 'Target locator role name')
    .option('--to-locator-role-value <value>', 'Target locator role value')
    .option('--steps <steps>', 'Number of drag steps')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const from = requireLocator({
          locatorRef: options.fromLocatorRef,
          locatorTestid: options.fromLocatorTestid,
          locatorCss: options.fromLocatorCss,
          locatorText: options.fromLocatorText,
          locatorRole: options.fromLocatorRole,
          locatorRoleValue: options.fromLocatorRoleValue,
        });
        const to = requireLocator({
          locatorRef: options.toLocatorRef,
          locatorTestid: options.toLocatorTestid,
          locatorCss: options.toLocatorCss,
          locatorText: options.toLocatorText,
          locatorRole: options.toLocatorRole,
          locatorRoleValue: options.toLocatorRoleValue,
        });
        const payload = parseInput(DriveDragInputSchema, {
          session_id: options.sessionId,
          from,
          to,
          steps: parseNumber(options.steps),
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/drag', payload);
      });
    });

  drive
    .command('handle-dialog')
    .description('Handle a JavaScript dialog')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--action <action>', 'Dialog action (accept, dismiss)')
    .option('--prompt-text <text>', 'Prompt text for prompt() dialogs')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveHandleDialogInputSchema, {
          session_id: options.sessionId,
          action: options.action,
          promptText: options.promptText,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/handle_dialog', payload);
      });
    });

  drive
    .command('key-press')
    .description('Press a keyboard key')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--key <key>', 'Key to press (e.g. Enter, ArrowDown)')
    .option('--ctrl', 'Hold control modifier')
    .option('--alt', 'Hold alt modifier')
    .option('--shift', 'Hold shift modifier')
    .option('--meta', 'Hold meta modifier')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveKeyPressInputSchema, {
          session_id: options.sessionId,
          key: options.key,
          modifiers: {
            ctrl: Boolean(options.ctrl),
            alt: Boolean(options.alt),
            shift: Boolean(options.shift),
            meta: Boolean(options.meta),
          },
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/key_press', payload);
      });
    });

  drive
    .command('key')
    .description('Press a keyboard key with modifiers')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--key <key>', 'Key to press (e.g. Enter, ArrowDown)')
    .option(
      '--modifier <modifier>',
      'Modifier key (ctrl, alt, shift, meta)',
      (value: string, previous: string[]) => [...(previous ?? []), value],
      []
    )
    .option('--repeat <count>', 'Number of times to press')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveKeyInputSchema, {
          session_id: options.sessionId,
          key: options.key,
          modifiers: options.modifier,
          repeat: parseNumber(options.repeat),
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/key', payload);
      });
    });

  drive
    .command('scroll')
    .description('Scroll the page')
    .requiredOption('--session-id <id>', 'Session identifier')
    .option('--delta-x <px>', 'Scroll delta X')
    .option('--delta-y <px>', 'Scroll delta Y')
    .option('--top <px>', 'Scroll top position')
    .option('--left <px>', 'Scroll left position')
    .option('--behavior <mode>', 'Scroll behavior (auto, smooth)')
    .option('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveScrollInputSchema, {
          session_id: options.sessionId,
          delta_x: parseNumber(options.deltaX),
          delta_y: parseNumber(options.deltaY),
          top: parseNumber(options.top),
          left: parseNumber(options.left),
          behavior: options.behavior,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/scroll', payload);
      });
    });

  drive
    .command('wait-for')
    .description('Wait for a condition')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption(
      '--kind <kind>',
      'Condition kind (locator_visible, text_present, url_matches)'
    )
    .requiredOption('--value <value>', 'Condition value')
    .option('--timeout-ms <ms>', 'Timeout in milliseconds')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveWaitForInputSchema, {
          session_id: options.sessionId,
          condition: {
            kind: options.kind,
            value: options.value,
          },
          timeout_ms: parseNumber(options.timeoutMs),
        });
        return client.post('/drive/wait_for', payload);
      });
    });

  drive
    .command('tab-list')
    .description('List browser tabs')
    .requiredOption('--session-id <id>', 'Session identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveTabListInputSchema, {
          session_id: options.sessionId,
        });
        return client.post('/drive/tab_list', payload);
      });
    });

  drive
    .command('tab-activate')
    .description('Activate a tab')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveTabActivateInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/tab_activate', payload);
      });
    });

  drive
    .command('tab-close')
    .description('Close a tab')
    .requiredOption('--session-id <id>', 'Session identifier')
    .requiredOption('--tab-id <id>', 'Tab identifier')
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveTabCloseInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post('/drive/tab_close', payload);
      });
    });
};
