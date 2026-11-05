import type { Message, ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import chalk from "chalk";
import { BedrockAgentClient } from "../bedrock/client.js";
import { PermissionManager } from "../permissions/manager.js";
import type { AgentConfig, ToolDefinition, ToolContext, SettingsConfig } from "../types.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { loadSkills } from "../skills/loader.js";
import { loadProjectMemory } from "../memory/projectMemory.js";
import { evaluatePermission } from "../permissions/rules.js";
import { runHooks } from "../hooks/manager.js";
import { estimateTokens, compactMessages } from "./compaction.js";
import { JobRegistry } from "../tools/jobs.js";
import { CheckpointManager } from "../checkpoints/manager.js";

export interface AgentLoopOptions {
  cwd: string;
  config: AgentConfig;
  tools: ToolDefinition[];
  permissions: PermissionManager;
  settings: SettingsConfig;
  isSubagent?: boolean;
  agentTypeAppend?: string;
  jobs?: JobRegistry;
  checkpoints?: CheckpointManager;
  initialMessages?: Message[];
  onAssistantText?: (text: string) => void;
}

export class AgentLoop {
  private client: BedrockAgentClient;
  private messages: Message[];
  private toolMap: Map<string, ToolDefinition>;
  private opts: AgentLoopOptions;
  private systemPrompt: string;
  private jobs: JobRegistry;
  private checkpoints: CheckpointManager;
  public totalInputTokens = 0;
  public totalOutputTokens = 0;

  constructor(opts: AgentLoopOptions) {
    this.opts = opts;
    this.client = new BedrockAgentClient(opts.config);
    this.toolMap = new Map(opts.tools.map((t) => [t.name, t]));
    this.jobs = opts.jobs ?? new JobRegistry();
    this.checkpoints = opts.checkpoints ?? new CheckpointManager();
    this.messages = opts.initialMessages ?? [];

    const skills = loadSkills(opts.cwd);
    const memory = loadProjectMemory(opts.cwd);
    this.systemPrompt = buildSystemPrompt(opts.cwd, skills, Boolean(opts.isSubagent), memory, opts.agentTypeAppend);
  }

  getMessages(): Message[] {
    return this.messages;
  }

  /** Drops older history and keeps only a short recap; used by /clear. */
  reset(): void {
    this.messages = [];
    this.checkpoints.clear();
  }

  async compactNow(): Promise<void> {
    this.messages = await compactMessages(this.client, this.messages, 10);
  }

  /** Runs the agent until it stops asking for tool calls, returns the final assistant text. */
  async run(userText: string): Promise<string> {
    const promptVerdict = await runHooks(this.opts.settings, "UserPromptSubmit", {
      event: "UserPromptSubmit",
      cwd: this.opts.cwd,
      prompt: userText,
    });
    if (promptVerdict.blocked) {
      return `(blocked by hook: ${promptVerdict.reason})`;
    }

    this.messages.push({ role: "user", content: [{ text: userText }] });

    if (estimateTokens(this.messages) > this.opts.config.compactionThresholdTokens) {
      console.log(chalk.dim("\n[context approaching limit — auto-compacting older history]"));
      await this.compactNow();
    }

    const toolSpecs = this.opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    let finalText = "";
    for (let iter = 0; iter < this.opts.config.maxAgentIterations; iter++) {
      const result = this.opts.config.streaming
        ? await this.client.converseStream(this.messages, this.systemPrompt, toolSpecs, (chunk) =>
            process.stdout.write(chalk.greenBright(chunk))
          )
        : await this.client.converse(this.messages, this.systemPrompt, toolSpecs);

      if (result.usage) {
        this.totalInputTokens += result.usage.inputTokens ?? 0;
        this.totalOutputTokens += result.usage.outputTokens ?? 0;
      }

      this.messages.push(result.message);

      const textBlocks = (result.message.content ?? [])
        .filter((b): b is { text: string } => Boolean((b as any).text))
        .map((b) => b.text);
      if (textBlocks.length) {
        finalText = textBlocks.join("\n");
        if (this.opts.config.streaming) {
          process.stdout.write("\n");
        } else {
          this.opts.onAssistantText?.(finalText);
        }
      }

      if (result.stopReason !== "tool_use") {
        await runHooks(this.opts.settings, "Stop", { event: "Stop", cwd: this.opts.cwd });
        return finalText;
      }

      const toolUseBlocks = (result.message.content ?? []).filter(
        (b): b is ContentBlock.ToolUseMember => Boolean((b as any).toolUse)
      );

      const readOnlyBlocks = toolUseBlocks.filter((b) => this.toolMap.get(b.toolUse!.name!)?.readOnly);
      const otherBlocks = toolUseBlocks.filter((b) => !this.toolMap.get(b.toolUse!.name!)?.readOnly);

      const results = new Map<string, ContentBlock>();

      await Promise.all(
        readOnlyBlocks.map(async (block) => {
          results.set(block.toolUse!.toolUseId!, await this.runToolCall(block));
        })
      );
      for (const block of otherBlocks) {
        results.set(block.toolUse!.toolUseId!, await this.runToolCall(block));
      }

      const toolResultBlocks: ContentBlock[] = toolUseBlocks.map(
        (b) => results.get(b.toolUse!.toolUseId!)!
      );

      this.messages.push({ role: "user", content: toolResultBlocks });
    }

    return finalText || "(stopped: max iterations reached)";
  }

  private async runToolCall(block: ContentBlock.ToolUseMember): Promise<ContentBlock> {
    const { toolUseId, name, input } = block.toolUse!;
    const tool = this.toolMap.get(name!);

    if (!tool) {
      return { toolResult: { toolUseId, content: [{ text: `Error: unknown tool "${name}"` }], status: "error" } };
    }

    const ctx: ToolContext = {
      cwd: this.opts.cwd,
      permissionMode: this.opts.permissions.getMode(),
      isSubagent: Boolean(this.opts.isSubagent),
      requestApproval: (summary, detail, scope) => this.opts.permissions.request(summary, detail, scope),
      askUser: (q, options, multi) => this.opts.permissions.askUser(q, options, multi),
      setPermissionMode: (mode) => this.opts.permissions.setMode(mode),
      jobs: this.jobs,
      checkpoints: this.checkpoints,
    };

    const preVerdict = await runHooks(this.opts.settings, "PreToolUse", {
      event: "PreToolUse",
      cwd: this.opts.cwd,
      toolName: tool.name,
      input,
    });
    if (preVerdict.blocked) {
      return {
        toolResult: { toolUseId, content: [{ text: `Blocked by hook: ${preVerdict.reason}` }], status: "error" },
      };
    }

    const settingsVerdict = evaluatePermission(tool.name, input, this.opts.settings);
    let approved: boolean;
    if (settingsVerdict === "deny") {
      approved = false;
    } else if (settingsVerdict === "allow") {
      approved = this.opts.permissions.getMode() === "plan" ? !tool.needsApproval(input) : true;
    } else if (settingsVerdict === "ask") {
      approved = await this.opts.permissions.request(`Run tool "${tool.name}"`, JSON.stringify(input, null, 2));
    } else if (tool.needsApproval(input) && this.opts.permissions.getMode() !== "auto") {
      approved = await this.opts.permissions.request(
        `Run tool "${tool.name}"`,
        JSON.stringify(input, null, 2),
        tool.name
      );
    } else {
      approved = true;
    }

    if (!approved) {
      return {
        toolResult: { toolUseId, content: [{ text: "User denied this tool call." }], status: "error" },
      };
    }

    console.log(chalk.dim(`\n→ ${tool.name}(${JSON.stringify(input)})`));
    try {
      const res = await tool.execute(input, ctx);
      console.log(chalk.dim(res.content.slice(0, 2000)));
      await runHooks(this.opts.settings, "PostToolUse", {
        event: "PostToolUse",
        cwd: this.opts.cwd,
        toolName: tool.name,
        input,
      });
      return {
        toolResult: { toolUseId, content: [{ text: res.content }], status: res.isError ? "error" : "success" },
      };
    } catch (err) {
      return {
        toolResult: {
          toolUseId,
          content: [{ text: `Error executing tool: ${(err as Error).message}` }],
          status: "error",
        },
      };
    }
  }
}
