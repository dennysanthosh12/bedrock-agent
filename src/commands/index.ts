import chalk from "chalk";
import type { AgentLoop } from "../agent/loop.js";
import type { PermissionManager } from "../permissions/manager.js";
import type { AgentConfig, SlashCommandDefinition, PermissionMode } from "../types.js";
import { loadCustomCommands } from "./loader.js";
import { loadAgentTypes } from "../agents/loader.js";
import { renderTodos } from "../tools/todoTool.js";
import { saveSession } from "../session/store.js";

export interface SlashContext {
  cwd: string;
  config: AgentConfig;
  loop: AgentLoop;
  permissions: PermissionManager;
  sessionId: string;
}

export interface SlashResult {
  handled: boolean;
  /** If set, feed this text into loop.run() as a normal turn (used by custom commands). */
  rewrittenPrompt?: string;
}

const BUILTIN_HELP = `
Built-in commands:
  /help              Show this help
  /clear             Clear conversation history
  /compact           Summarize older history now to free up context
  /cost              Show token usage for this session
  /config            Show current configuration
  /mode <mode>       Switch permission mode: default | auto | plan
  /agents            List available subagent types
  /todos             Show the current todo list
  /save              Save the session now
  /exit, /quit       Exit
`;

export async function handleSlashCommand(raw: string, ctx: SlashContext): Promise<SlashResult> {
  const [cmd, ...rest] = raw.trim().slice(1).split(/\s+/);
  const args = rest.join(" ");

  switch (cmd) {
    case "help":
      console.log(chalk.cyan(BUILTIN_HELP));
      return { handled: true };

    case "clear":
      ctx.loop.reset();
      console.log(chalk.gray("Conversation cleared."));
      return { handled: true };

    case "compact":
      console.log(chalk.gray("Compacting..."));
      await ctx.loop.compactNow();
      console.log(chalk.gray("Done."));
      return { handled: true };

    case "cost":
      console.log(
        chalk.cyan(
          `Input tokens: ${ctx.loop.totalInputTokens}  Output tokens: ${ctx.loop.totalOutputTokens}`
        )
      );
      return { handled: true };

    case "config":
      console.log(chalk.cyan(JSON.stringify(ctx.config, null, 2)));
      return { handled: true };

    case "mode": {
      const mode = args.trim() as PermissionMode;
      if (!["default", "auto", "plan"].includes(mode)) {
        console.log(chalk.red(`Unknown mode "${args}". Use default | auto | plan.`));
      } else {
        ctx.permissions.setMode(mode);
        console.log(chalk.gray(`Permission mode set to ${mode}.`));
      }
      return { handled: true };
    }

    case "agents": {
      const types = loadAgentTypes(ctx.cwd);
      console.log(chalk.cyan(types.map((a) => `- ${a.name}: ${a.description}`).join("\n")));
      return { handled: true };
    }

    case "todos":
      console.log(chalk.magenta(renderTodos()));
      return { handled: true };

    case "save":
      saveSession(ctx.cwd, ctx.sessionId, ctx.loop.getMessages());
      console.log(chalk.gray(`Session saved (${ctx.sessionId}).`));
      return { handled: true };

    case "exit":
    case "quit":
      return { handled: true };

    default: {
      const custom = loadCustomCommands(ctx.cwd).find((c: SlashCommandDefinition) => c.name === cmd);
      if (custom) {
        return { handled: false, rewrittenPrompt: custom.body.replaceAll("{{args}}", args) };
      }
      console.log(chalk.red(`Unknown command: /${cmd}. Type /help for a list.`));
      return { handled: true };
    }
  }
}
