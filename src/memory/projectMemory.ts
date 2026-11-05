import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CANDIDATE_NAMES = ["AGENTS.md", "CLAUDE.md", "AGENT.md"];

function readFirstExisting(dir: string): string | null {
  for (const name of CANDIDATE_NAMES) {
    const path = join(dir, name);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8").trim();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Loads global (~/.agent/AGENTS.md) then project-root memory files, like Claude Code's CLAUDE.md layering. */
export function loadProjectMemory(cwd: string): string {
  const global = readFirstExisting(join(homedir(), ".agent"));
  const project = readFirstExisting(cwd);
  const parts: string[] = [];
  if (global) parts.push(`# Global instructions\n\n${global}`);
  if (project) parts.push(`# Project instructions\n\n${project}`);
  return parts.join("\n\n---\n\n");
}
