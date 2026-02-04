import { Command } from "commander";
import {
  InspectConsoleListInputSchema,
  InspectDomSnapshotInputSchema,
  InspectEvaluateInputSchema,
  InspectNetworkHarInputSchema,
  InspectPerformanceMetricsInputSchema,
} from "@browser-vision/shared";
import { parseInput } from "../cli-output";
import { runCommand } from "../cli-runtime";

export const registerInspectCommands = (program: Command): void => {
  const inspect = program.command("inspect").description("Inspect commands");

  inspect
    .command("dom-snapshot")
    .description("Fetch a DOM snapshot")
    .requiredOption("--session-id <id>", "Session identifier")
    .option("--format <format>", "Snapshot format (ax, html)")
    .option("--consistency <mode>", "Consistency mode (best_effort, quiesce)")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectDomSnapshotInputSchema, {
          session_id: options.sessionId,
          format: options.format,
          consistency: options.consistency,
        });
        return client.post("/inspect/dom_snapshot", payload);
      });
    });

  inspect
    .command("console-list")
    .description("Fetch console entries")
    .requiredOption("--session-id <id>", "Session identifier")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectConsoleListInputSchema, {
          session_id: options.sessionId,
        });
        return client.post("/inspect/console_list", payload);
      });
    });

  inspect
    .command("network-har")
    .description("Fetch network HAR")
    .requiredOption("--session-id <id>", "Session identifier")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectNetworkHarInputSchema, {
          session_id: options.sessionId,
        });
        return client.post("/inspect/network_har", payload);
      });
    });

  inspect
    .command("evaluate")
    .description("Evaluate a JavaScript expression")
    .requiredOption("--session-id <id>", "Session identifier")
    .option("--expression <expr>", "Expression to evaluate")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectEvaluateInputSchema, {
          session_id: options.sessionId,
          expression: options.expression,
        });
        return client.post("/inspect/evaluate", payload);
      });
    });

  inspect
    .command("performance-metrics")
    .description("Fetch performance metrics")
    .requiredOption("--session-id <id>", "Session identifier")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(InspectPerformanceMetricsInputSchema, {
          session_id: options.sessionId,
        });
        return client.post("/inspect/performance_metrics", payload);
      });
    });
};
