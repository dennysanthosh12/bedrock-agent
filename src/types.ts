export type PermissionMode = "default" | "auto" | "plan";

export interface AgentConfig {
  region: string;
  profile: string | null;
  modelId: string;
  permissionMode: PermissionMode;
  maxTokens: number;
  maxAgentIterations: number;
  /** Soft token budget; once exceeded the loop auto-compacts older history. */
  compactionThresholdTokens: number;
  streaming: boolean;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ToolContext {
  cwd: string;
  permissionMode: PermissionMode;
  /** true when running inside a subagent (no nested Task tool, no interactive prompts bubble to parent) */
  isSubagent: boolean;
  requestApproval: (summary: string, detail: string, scope?: string) => Promise<boolean>;
  /** Prompts the user to pick from a list of options (used by AskUserQuestion). Returns chosen label(s). */
  askUser: (question: string, options: { label: string; description?: string }[], multiSelect?: boolean) => Promise<string[]>;
  /** Switches the live permission mode (used by EnterPlanMode/ExitPlanMode). */
  setPermissionMode: (mode: PermissionMode) => void;
  /** background-shell job registry, shared across Bash/BashOutput/KillShell tools */
  jobs: import("./tools/jobs.js").JobRegistry;
  /** file-mutation undo stack, used by Write/Edit (to record) and Undo (to pop) */
  checkpoints: import("./checkpoints/manager.js").CheckpointManager;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool's input */
  inputSchema: Record<string, unknown>;
  /** Whether invoking this tool requires permission approval (unless mode is "auto") */
  needsApproval: (input: any) => boolean;
  execute: (input: any, ctx: ToolContext) => Promise<ToolResult>;
  /** Pure read-only tools may run concurrently with other read-only tool calls in the same turn. */
  readOnly?: boolean;
}

export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop"
  | "SessionStart";

export interface HookDefinition {
  matcher?: string; // regex against tool name; omitted = matches all
  command: string; // shell command; receives JSON on stdin, may print JSON {decision, reason} to stdout
}

export interface SettingsConfig {
  permissions: {
    allow: string[]; // glob-ish patterns like "Bash(git *)" or "Read"
    deny: string[];
    ask: string[];
  };
  hooks: Partial<Record<HookEventName, HookDefinition[]>>;
}

export interface AgentTypeDefinition {
  name: string;
  description: string;
  tools: string[] | "*"; // names of tools this subagent type may use
  systemPromptAppend?: string;
}

export interface SlashCommandDefinition {
  name: string;
  description: string;
  /** Template body; {{args}} is substituted with whatever follows the command. */
  body: string;
}
