---
name: example-skill
description: Example skill showing the expected format. Replace with real skills.
---

# Example Skill

This is a placeholder skill. Skills are markdown files with YAML frontmatter
(`name`, `description`) placed under `.agent/skills/<skill-name>/SKILL.md`.

The agent lists all available skills (name + description) in its system
prompt, and loads the full body of a skill on demand via the `Skill` tool
when the task matches its description.
