import type { ToolDefinition, AgentConfig } from "../types.js";
import type { LineReader } from "../utils/lineReader.js";
import { readTool, writeTool, editTool, globTool, grepTool, undoTool } from "./fileTools.js";
import { bashTool, bashOutputTool, killShellTool } from "./bashTool.js";
import { skillTool } from "./skillTool.js";
import { buildTaskTool } from "./taskTool.js";
import { todoWriteTool } from "./todoTool.js";
import { webFetchTool, webSearchTool } from "./webTools.js";
import { askUserQuestionTool } from "./askUserTool.js";
import { enterPlanModeTool, exitPlanModeTool } from "./planTool.js";
import { notebookEditTool } from "./notebookTool.js";
import { McpManager } from "../mcp/manager.js";
import { loadAgentTypes } from "../agents/loader.js";

export async function buildToolset(
  cwd: string,
  config: AgentConfig,
  mcp: McpManager,
  lines: LineReader
): Promise<ToolDefinition[]> {
  const mcpTools = await mcp.getToolDefinitions();
  const agentTypes = loadAgentTypes(cwd);

  const baseTools: ToolDefinition[] = [
    readTool,
    writeTool,
    editTool,
    undoTool,
    globTool,
    grepTool,
    bashTool,
    bashOutputTool,
    killShellTool,
    skillTool,
    todoWriteTool,
    webFetchTool,
    webSearchTool,
    askUserQuestionTool,
    enterPlanModeTool,
    exitPlanModeTool,
    notebookEditTool,
    ...mcpTools,
  ];

  const taskTool = buildTaskTool(config, baseTools, agentTypes, lines);
  return [...baseTools, taskTool];
}
