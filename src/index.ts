#!/usr/bin/env node
import readline from "node:readline";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { loadSettings } from "./settings.js";
import { PermissionManager } from "./permissions/manager.js";
import { AgentLoop } from "./agent/loop.js";
import { buildToolset } from "./tools/index.js";
import { McpManager } from "./mcp/manager.js";
import { JobRegistry } from "./tools/jobs.js";
import { CheckpointManager } from "./checkpoints/manager.js";
import { handleSlashCommand } from "./commands/index.js";
import { newSessionId, saveSession, loadSession, latestSession } from "./session/store.js";
import { runHooks } from "./hooks/manager.js";
import { LineReader } from "./utils/lineReader.js";
import type { PermissionMode } from "./types.js";

function parseArgs(argv: string[]) {
  const args = [...argv];
  let mode: PermissionMode | undefined;
  let resumeId: string | undefined;
  let continueLast = false;

  for (let i = args.length - 1; i >= 0; i--) {
    if (args[i] === "--mode" && args[i + 1]) {
      mode = args[i + 1] as PermissionMode;
      args.splice(i, 2);
    } else if (args[i] === "--resume" && args[i + 1]) {
      resumeId = args[i + 1];
      args.splice(i, 2);
    } else if (args[i] === "--continue") {
      continueLast = true;
      args.splice(i, 1);
    }
  }
  return { mode, resumeId, continueLast, oneShot: args.join(" ").trim() };
}

async function main() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const settings = loadSettings(cwd);
  const { mode, resumeId, continueLast, oneShot } = parseArgs(process.argv.slice(2));
  if (mode) config.permissionMode = mode;

  console.log(
    chalk.bold.cyan("Bedrock Agent") +
      chalk.gray(`  (model: ${config.modelId}, region: ${config.region}, mode: ${config.permissionMode})`)
  );

  await runHooks(settings, "SessionStart", { event: "SessionStart", cwd });

  const mcp = new McpManager();
  await mcp.connectAll(cwd);

  // Created once and shared (including inside subagents) via LineReader, which reads the
  // interface as an async iterable — readline's promise-based .question() silently drops
  // buffered lines on non-TTY stdin when called repeatedly, so all prompting goes through this.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = new LineReader(rl);
  const tools = await buildToolset(cwd, config, mcp, lines);
  const permissions = new PermissionManager(config.permissionMode, lines);
  const jobs = new JobRegistry();
  const checkpoints = new CheckpointManager();

  let sessionId = newSessionId();
  let initialMessages;
  if (resumeId) {
    const session = loadSession(cwd, resumeId);
    if (session) {
      sessionId = session.id;
      initialMessages = session.messages;
      console.log(chalk.gray(`Resumed session ${sessionId} (${session.messages.length} messages).`));
    } else {
      console.log(chalk.red(`No session found with id ${resumeId}; starting fresh.`));
    }
  } else if (continueLast) {
    const session = latestSession(cwd);
    if (session) {
      sessionId = session.id;
      initialMessages = session.messages;
      console.log(chalk.gray(`Continuing most recent session ${sessionId} (${session.messages.length} messages).`));
    }
  }

  const loop = new AgentLoop({
    cwd,
    config,
    tools,
    permissions,
    settings,
    jobs,
    checkpoints,
    initialMessages,
    onAssistantText: (text) => {
      console.log(chalk.greenBright("\nAssistant:"), text);
    },
  });

  const shutdown = async () => {
    saveSession(cwd, sessionId, loop.getMessages());
    lines.close();
    await mcp.closeAll();
  };
  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });

  if (oneShot) {
    try {
      await loop.run(oneShot);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
    await shutdown();
    return;
  }

  console.log(chalk.gray('Type a request, "/help" for commands, or "exit" to quit.\n'));
  while (true) {
    const input = await lines.ask(chalk.bold("> "));
    if (input === null) break; // stdin closed (EOF)
    if (!input.trim()) continue;
    if (["exit", "quit"].includes(input.trim().toLowerCase())) break;

    if (input.trim().startsWith("/")) {
      const result = await handleSlashCommand(input, { cwd, config, loop, permissions, sessionId });
      if (result.handled) {
        if (["/exit", "/quit"].includes(input.trim().toLowerCase())) break;
        continue;
      }
      if (result.rewrittenPrompt) {
        try {
          await loop.run(result.rewrittenPrompt);
        } catch (err) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        saveSession(cwd, sessionId, loop.getMessages());
      }
      continue;
    }

    try {
      await loop.run(input);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
    saveSession(cwd, sessionId, loop.getMessages());
  }
  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
