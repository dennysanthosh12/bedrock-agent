import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { SlashCommandDefinition } from "../types.js";

export function loadCustomCommands(cwd: string): SlashCommandDefinition[] {
  const dir = join(cwd, ".agent", "commands");
  if (!existsSync(dir)) return [];
  const commands: SlashCommandDefinition[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    try {
      const { data, content } = matter(readFileSync(join(dir, entry), "utf-8"));
      commands.push({
        name: entry.replace(/\.md$/, ""),
        description: data.description ?? "",
        body: content.trim(),
      });
    } catch {
      // ignore malformed command files
    }
  }
  return commands;
}
