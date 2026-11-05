import type { ToolDefinition } from "../types.js";
import { loadSkills, readSkillBody } from "../skills/loader.js";

export const skillTool: ToolDefinition = {
  name: "Skill",
  description:
    "Load the full instructions for a named skill (from the available-skills list in the system prompt) so you can follow them.",
  inputSchema: {
    type: "object",
    properties: {
      skill: { type: "string", description: "Exact skill name from the available-skills list" },
      args: { type: "string", description: "Optional arguments to pass to the skill" },
    },
    required: ["skill"],
  },
  needsApproval: () => false,
  async execute(input, ctx) {
    const skills = loadSkills(ctx.cwd);
    const found = skills.find((s) => s.name === input.skill);
    if (!found) {
      return {
        content: `Error: no skill named "${input.skill}". Available: ${skills.map((s) => s.name).join(", ") || "(none)"}`,
        isError: true,
      };
    }
    const body = readSkillBody(found.path);
    return {
      content: `# Skill: ${found.name}${input.args ? `\nArgs: ${input.args}` : ""}\n\n${body}`,
    };
  },
};
