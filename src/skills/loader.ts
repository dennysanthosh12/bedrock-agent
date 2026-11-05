import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export function loadSkills(cwd: string): SkillInfo[] {
  const skillsDir = join(cwd, ".agent", "skills");
  if (!existsSync(skillsDir)) return [];

  const skills: SkillInfo[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const skillPath = join(skillsDir, entry, "SKILL.md");
    if (!existsSync(skillPath) || !statSync(skillPath).isFile()) continue;
    try {
      const { data } = matter(readFileSync(skillPath, "utf-8"));
      if (data.name && data.description) {
        skills.push({ name: data.name, description: data.description, path: skillPath });
      }
    } catch {
      // ignore malformed skill files
    }
  }
  return skills;
}

export function readSkillBody(skillPath: string): string {
  const { content } = matter(readFileSync(skillPath, "utf-8"));
  return content.trim();
}
