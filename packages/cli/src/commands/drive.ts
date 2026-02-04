import { Command } from "commander";
import {
  DriveClickInputSchema,
  DriveNavigateInputSchema,
  DriveScrollInputSchema,
  DriveTabActivateInputSchema,
  DriveTabCloseInputSchema,
  DriveTabListInputSchema,
  DriveTypeInputSchema,
  DriveWaitForInputSchema,
} from "@browser-vision/shared";
import { parseInput } from "../cli-output";
import { runCommand } from "../cli-runtime";
import { buildLocator, requireLocator } from "../locator";

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const registerDriveCommands = (program: Command): void => {
  const drive = program.command("drive").description("Drive commands");

  drive
    .command("navigate")
    .description("Navigate to a URL")
    .requiredOption("--session-id <id>", "Session identifier")
    .requiredOption("--url <url>", "URL to navigate to")
    .option("--wait <mode>", "Wait mode (none, domcontentloaded)")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveNavigateInputSchema, {
          session_id: options.sessionId,
          url: options.url,
          wait: options.wait,
        });
        return client.post("/drive/navigate", payload);
      });
    });

  drive
    .command("click")
    .description("Click an element")
    .requiredOption("--session-id <id>", "Session identifier")
    .option("--locator-testid <id>", "Locator test id")
    .option("--locator-css <selector>", "Locator CSS selector")
    .option("--locator-text <text>", "Locator text")
    .option("--locator-role <role>", "Locator role name")
    .option("--locator-role-value <value>", "Locator role value")
    .option("--click-count <count>", "Click count")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const locator = requireLocator({
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
        return client.post("/drive/click", payload);
      });
    });

  drive
    .command("type")
    .description("Type into a field")
    .requiredOption("--session-id <id>", "Session identifier")
    .requiredOption("--text <text>", "Text to enter")
    .option("--locator-testid <id>", "Locator test id")
    .option("--locator-css <selector>", "Locator CSS selector")
    .option("--locator-text <text>", "Locator text")
    .option("--locator-role <role>", "Locator role name")
    .option("--locator-role-value <value>", "Locator role value")
    .option("--clear", "Clear input before typing")
    .option("--submit", "Submit after typing")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const locator = buildLocator({
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
        return client.post("/drive/type", payload);
      });
    });

  drive
    .command("scroll")
    .description("Scroll the page")
    .requiredOption("--session-id <id>", "Session identifier")
    .option("--delta-x <px>", "Scroll delta X")
    .option("--delta-y <px>", "Scroll delta Y")
    .option("--top <px>", "Scroll top position")
    .option("--left <px>", "Scroll left position")
    .option("--behavior <mode>", "Scroll behavior (auto, smooth)")
    .option("--tab-id <id>", "Tab identifier")
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
        return client.post("/drive/scroll", payload);
      });
    });

  drive
    .command("wait-for")
    .description("Wait for a condition")
    .requiredOption("--session-id <id>", "Session identifier")
    .requiredOption(
      "--kind <kind>",
      "Condition kind (locator_visible, text_present, url_matches)"
    )
    .requiredOption("--value <value>", "Condition value")
    .option("--timeout-ms <ms>", "Timeout in milliseconds")
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
        return client.post("/drive/wait_for", payload);
      });
    });

  drive
    .command("tab-list")
    .description("List browser tabs")
    .requiredOption("--session-id <id>", "Session identifier")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveTabListInputSchema, {
          session_id: options.sessionId,
        });
        return client.post("/drive/tab_list", payload);
      });
    });

  drive
    .command("tab-activate")
    .description("Activate a tab")
    .requiredOption("--session-id <id>", "Session identifier")
    .requiredOption("--tab-id <id>", "Tab identifier")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveTabActivateInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post("/drive/tab_activate", payload);
      });
    });

  drive
    .command("tab-close")
    .description("Close a tab")
    .requiredOption("--session-id <id>", "Session identifier")
    .requiredOption("--tab-id <id>", "Tab identifier")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(DriveTabCloseInputSchema, {
          session_id: options.sessionId,
          tab_id: parseNumber(options.tabId),
        });
        return client.post("/drive/tab_close", payload);
      });
    });
};
