import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { AgentTypeDefinition } from "../types.js";

const BUILTIN_AGENT_TYPES: AgentTypeDefinition[] = [
  {
    name: "general-purpose",
    description: "General-purpose agent for research, multi-step search, and open-ended sub-tasks. Has access to all tools.",
    tools: "*",
  },
  {
    name: "explore",
    description: "Fast read-only search agent for locating code: files by pattern, grep for symbols, etc. Cannot edit files or run commands.",
    tools: ["Read", "Glob", "Grep", "WebFetch"],
  },
];

/** Loads custom subagent type definitions from .agent/agents/*.md (frontmatter: name, description, tools). */
export function loadAgentTypes(cwd: string): AgentTypeDefinition[] {
  const dir = join(cwd, ".agent", "agents");
  const custom: AgentTypeDefinition[] = [];
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      try {
        const { data, content } = matter(readFileSync(join(dir, entry), "utf-8"));
        if (!data.name || !data.description) continue;
        custom.push({
          name: data.name,
          description: data.description,
          tools: data.tools === "*" || !data.tools ? "*" : String(data.tools).split(",").map((s) => s.trim()),
          systemPromptAppend: content.trim() || undefined,
        });
      } catch {
        // ignore malformed agent definitions
      }
    }
  }
  const byName = new Map(BUILTIN_AGENT_TYPES.map((a) => [a.name, a]));
  for (const c of custom) byName.set(c.name, c); // project definitions override built-ins of the same name
  return [...byName.values()];
}
