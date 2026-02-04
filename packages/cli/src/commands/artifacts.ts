import { Command } from "commander";
import { ArtifactsScreenshotInputSchema } from "@browser-vision/shared";
import { parseInput } from "../cli-output";
import { runCommand } from "../cli-runtime";

export const registerArtifactsCommands = (program: Command): void => {
  const artifacts = program.command("artifacts").description("Artifact commands");

  artifacts
    .command("screenshot")
    .description("Request a screenshot artifact")
    .requiredOption("--session-id <id>", "Session identifier")
    .option("--target <target>", "Screenshot target (viewport, full)")
    .action(async (options, command) => {
      await runCommand(command, (client) => {
        const payload = parseInput(ArtifactsScreenshotInputSchema, {
          session_id: options.sessionId,
          target: options.target,
        });
        return client.post("/artifacts/screenshot", payload);
      });
    });
};
