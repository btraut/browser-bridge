#!/usr/bin/env node
import { Command } from "commander";
import { registerSessionCommands } from "./commands/session";

const program = new Command();

program
  .name("browser-vision")
  .description("Browser Vision CLI")
  .option("--host <host>", "Core host (default: 127.0.0.1)")
  .option("--port <port>", "Core port (default: 3210)")
  .option("--json", "Output JSON")
  .option("--no-daemon", "Disable auto-starting Core");

registerSessionCommands(program);

void program.parseAsync(process.argv);
