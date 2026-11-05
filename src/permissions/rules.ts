import type { SettingsConfig } from "../types.js";

/** Pulls the most relevant string out of a tool's input to match argument patterns against. */
function subjectFor(toolName: string, input: any): string {
  if (toolName === "Bash") return input?.command ?? "";
  if (input?.file_path) return input.file_path;
  if (input?.notebook_path) return input.notebook_path;
  if (input?.pattern) return input.pattern;
  if (input?.url) return input.url;
  return JSON.stringify(input ?? {});
}

/** Parses "ToolName" or "ToolName(argGlob)" into parts. */
function parsePattern(pattern: string): { tool: string; argGlob: string | null } {
  const match = pattern.match(/^([A-Za-z_][\w]*)\((.*)\)$/);
  if (match) return { tool: match[1], argGlob: match[2] };
  return { tool: pattern, argGlob: null };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matches(pattern: string, toolName: string, input: any): boolean {
  const { tool, argGlob } = parsePattern(pattern);
  if (tool !== toolName && tool !== "*") return false;
  if (argGlob === null) return true;
  return globToRegExp(argGlob).test(subjectFor(toolName, input));
}

export type PermissionVerdict = "allow" | "deny" | "ask" | undefined;

/** Checks deny first, then allow, then ask; undefined means "no rule matched, use tool default". */
export function evaluatePermission(toolName: string, input: any, settings: SettingsConfig): PermissionVerdict {
  if (settings.permissions.deny.some((p) => matches(p, toolName, input))) return "deny";
  if (settings.permissions.allow.some((p) => matches(p, toolName, input))) return "allow";
  if (settings.permissions.ask.some((p) => matches(p, toolName, input))) return "ask";
  return undefined;
}
