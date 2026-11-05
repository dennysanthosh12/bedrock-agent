import type { ToolDefinition, AgentConfig, AgentTypeDefinition } from "../types.js";
import { PermissionManager } from "../permissions/manager.js";
import { AgentLoop } from "../agent/loop.js";
import { JobRegistry } from "./jobs.js";
import { CheckpointManager } from "../checkpoints/manager.js";
import { loadSettings } from "../settings.js";
import type { LineReader } from "../utils/lineReader.js";

/**
 * Builds the Task tool, which spawns an isolated subagent (its own conversation history,
 * job registry, and checkpoint stack) restricted to the tool set of the chosen agent type.
 * Subagents never get a Task tool themselves, capping nesting at one level.
 *
 * `lines` is the single process-wide LineReader, reused for the subagent's approval prompts
 * instead of opening a second readline.Interface on stdin.
 */
export function buildTaskTool(
  config: AgentConfig,
  availableTools: ToolDefinition[],
  agentTypes: AgentTypeDefinition[],
  lines: LineReader
): ToolDefinition {
  const toolsByName = new Map(availableTools.map((t) => [t.name, t]));

  return {
    name: "Task",
    description:
      "Launch an independent subagent to handle a self-contained task. The subagent has no memory of this conversation, " +
      "so give it full context in the prompt. Returns the subagent's final report.\n\nAvailable subagent_type values:\n" +
      agentTypes.map((a) => `- ${a.name}: ${a.description}`).join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Short 3-5 word description of the task" },
        prompt: { type: "string", description: "Full, self-contained task instructions for the subagent" },
        subagent_type: {
          type: "string",
          description: "Which agent type to use; defaults to general-purpose",
          enum: agentTypes.map((a) => a.name),
        },
      },
      required: ["description", "prompt"],
    },
    needsApproval: () => false,
    async execute(input, ctx) {
      const agentType =
        agentTypes.find((a) => a.name === input.subagent_type) ??
        agentTypes.find((a) => a.name === "general-purpose") ??
        agentTypes[0];

      const subagentTools =
        agentType.tools === "*"
          ? availableTools.filter((t) => t.name !== "Task")
          : agentType.tools.map((n) => toolsByName.get(n)).filter((t): t is ToolDefinition => Boolean(t));

      const permissions = new PermissionManager(ctx.permissionMode, lines);
      const loop = new AgentLoop({
        cwd: ctx.cwd,
        config,
        tools: subagentTools,
        permissions,
        isSubagent: true,
        agentTypeAppend: agentType.systemPromptAppend,
        settings: loadSettings(ctx.cwd),
        jobs: new JobRegistry(),
        checkpoints: new CheckpointManager(),
      });
      try {
        const result = await loop.run(input.prompt);
        return { content: result };
      } finally {
        permissions.close();
      }
    },
  };
}
