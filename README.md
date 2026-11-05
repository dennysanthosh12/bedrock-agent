# Bedrock Agent

A Claude-Code-style agentic coding CLI. Every piece of orchestration (tools, permissions,
hooks, subagents, sessions, memory, slash commands) is implemented and model-agnostic — the
**only** integration point left for you is the Bedrock model call itself (`src/bedrock/client.ts`)
plus your AWS credentials/model ID.

## Feature list

| Area | What's implemented |
|---|---|
| Agentic loop | `Converse`/`ConverseStream` tool-use loop (`src/agent/loop.ts`), streaming output, parallel execution of read-only tool calls within a turn |
| File tools | `Read`, `Write`, `Edit` (with unified diff output), `Undo` (session-scoped checkpoint stack), `Glob`, `Grep` |
| Shell | `Bash` (foreground + `run_in_background`), `BashOutput`, `KillShell` |
| Planning/tracking | `TodoWrite`, `EnterPlanMode` / `ExitPlanMode` |
| Web | `WebFetch`, `WebSearch` (Brave or SerpAPI, pluggable) |
| Interaction | `AskUserQuestion` (multi-option CLI prompts) |
| Notebooks | `NotebookEdit` (.ipynb cell replace/insert/delete) |
| Subagents | `Task` tool spawns an isolated `AgentLoop`; subagent **types** defined in `.agent/agents/*.md` (frontmatter: `name`, `description`, `tools`), capped at one level of nesting |
| Skills | `.agent/skills/<name>/SKILL.md`, listed in the system prompt, loaded on demand via the `Skill` tool |
| MCP | Any number of stdio MCP servers in `.agent/mcp.json`; tools auto-exposed as `mcp__<server>__<tool>` |
| Permissions | Modes `default`/`auto`/`plan` **plus** declarative `.agent/settings.json` allow/deny/ask rules (`Bash(git *)`-style patterns), layered with a gitignored `.agent/settings.local.json` |
| Hooks | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart` — arbitrary shell commands, JSON on stdin, block by exiting non-zero or printing `{"decision":"block","reason":"..."}` |
| Slash commands | Built-ins (`/help /clear /compact /cost /config /mode /agents /todos /save /exit`) plus custom commands from `.agent/commands/*.md` (`{{args}}` templating) |
| Memory | Project `AGENTS.md`/`CLAUDE.md` at repo root + global `~/.agent/AGENTS.md`, both folded into the system prompt |
| Sessions | Auto-saved every turn to `.agent/sessions/<id>.json`; resume with `--continue` (most recent) or `--resume <id>` |
| Context management | Auto-compaction above a token threshold (summarizes older turns via the model itself), plus manual `/compact` |
| Checkpoints | `Write`/`Edit`/`NotebookEdit` record a pre-image; `Undo` tool reverts the last N mutations |

## Setup

```powershell
npm install
npm run build
```

### AWS credentials — the integration point

Uses the standard AWS SDK credential chain — any of these work:

- `aws configure` / `aws sso login` (default profile or `AWS_PROFILE=<name>`)
- Environment variables `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
- An EC2/ECS/Lambda IAM role

The IAM identity needs `bedrock:InvokeModel`/`bedrock:InvokeModelWithResponseStream` (the
`Converse`/`ConverseStream` APIs) for the model(s) you use.

### Config

Edit `.agent/config.json` (or override with env vars):

| Setting | Env var | Notes |
|---|---|---|
| `region` | `AWS_REGION` | Bedrock region, e.g. `us-east-1` |
| `profile` | `AWS_PROFILE` | Named AWS CLI profile |
| `modelId` | `AGENT_MODEL_ID` | Bedrock model/inference-profile ID |
| `permissionMode` | `AGENT_PERMISSION_MODE` | `default` \| `auto` \| `plan` |
| `streaming` | `AGENT_STREAMING` | `true`/`false` — use `ConverseStream` vs `Converse` |
| `maxTokens`, `maxAgentIterations`, `compactionThresholdTokens` | — | tune per model/workload |

**Important:** the default `modelId` is a placeholder for the cheapest current Claude Haiku
model. Bedrock model IDs vary by account/region and change as new versions ship — confirm the
exact ID (and enable model access) via:

```powershell
aws bedrock list-foundation-models --region us-east-1 --query "modelSummaries[?contains(modelId,'claude')].modelId"
```

Some regions require a cross-region **inference profile** ID instead of the base `modelId`
(e.g. `us.anthropic.claude-...`) — check `aws bedrock list-inference-profiles` if a direct
`modelId` call errors with "on-demand throughput isn't supported".

## Usage

```powershell
npm run build
node dist/index.js                        # interactive REPL
node dist/index.js "fix the failing test in src/foo.ts"   # one-shot
node dist/index.js --mode auto "..."      # skip approval prompts
node dist/index.js --mode plan "..."      # read-only / dry-run
node dist/index.js --continue             # resume the most recent session in this cwd
node dist/index.js --resume <session-id>  # resume a specific session
```

Inside the REPL, `/help` lists built-in commands.

## Configuring permissions (`.agent/settings.json`)

```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "TodoWrite"],
    "deny": ["Bash(rm -rf *)", "Bash(git push --force*)"],
    "ask": ["Write(*.env)"]
  },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "command": "node scripts/audit-bash.js" }]
  }
}
```

Patterns are `ToolName` or `ToolName(argGlob)`, matched against the tool's command/file_path/etc.
`deny` beats `allow` beats `ask` beats the tool's own default approval behavior. Put personal,
gitignored overrides in `.agent/settings.local.json` (merged on top).

## Adding MCP servers

Edit `.agent/mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

## Adding skills

`.agent/skills/<skill-name>/SKILL.md`:

```markdown
---
name: my-skill
description: One-line description used to decide when this skill is relevant.
---

Full instructions the model should follow when this skill is invoked...
```

## Adding subagent types

`.agent/agents/<name>.md`:

```markdown
---
name: code-reviewer
description: Reviews a diff for correctness/security/style issues. Read-only.
tools: Read, Glob, Grep, Bash
---

Extra system-prompt instructions specific to this agent type.
```

`tools: "*"` (or omitted) grants every tool except `Task` itself (no nested subagent spawning).

## Adding custom slash commands

`.agent/commands/<name>.md`:

```markdown
---
description: Shown in /help
---

Prompt template body. {{args}} is replaced with whatever follows /<name>.
```

## Project memory

Drop an `AGENTS.md` (or `CLAUDE.md`) in the project root for project-specific instructions, and/or
`~/.agent/AGENTS.md` for instructions that apply across every project. Both are folded into the
system prompt automatically.

## Project layout

```
src/
  index.ts                 CLI entrypoint / REPL / session + slash-command wiring
  config.ts                Loads .agent/config.json + env overrides
  settings.ts               Loads .agent/settings.json (+ .local override)
  bedrock/client.ts         ** Bedrock Converse/ConverseStream wrapper — the model integration point **
  agent/loop.ts             Core agentic loop: tool dispatch, hooks, permissions, streaming
  agent/systemPrompt.ts
  agent/compaction.ts       Token estimate + auto-summarization
  permissions/manager.ts    Approval prompts / mode switching
  permissions/rules.ts      settings.json allow/deny/ask pattern matching
  hooks/manager.ts          Pre/PostToolUse, UserPromptSubmit, Stop, SessionStart hooks
  tools/                    Read, Write, Edit, Undo, Glob, Grep, Bash(+BashOutput/KillShell),
                             TodoWrite, WebFetch, WebSearch, AskUserQuestion, EnterPlanMode,
                             ExitPlanMode, NotebookEdit, Skill, Task
  agents/loader.ts          Subagent type definitions (.agent/agents/*.md)
  skills/loader.ts          SKILL.md discovery/parsing
  commands/                 Built-in + custom (.agent/commands/*.md) slash commands
  memory/projectMemory.ts   AGENTS.md/CLAUDE.md loading
  session/store.ts          Session persistence (save/load/list/continue/resume)
  checkpoints/manager.ts    File-mutation undo stack
  mcp/manager.ts            MCP stdio client manager
  utils/diff.ts             Unified-style line diff for Write/Edit output
  utils/lineReader.ts       Shared stdin line reader (works for both TTY and piped input)
.agent/
  config.json
  settings.json / settings.local.json (gitignored)
  mcp.json
  skills/
  agents/
  commands/
  sessions/ (gitignored, auto-created)
```

## Known limitations

- No automatic image/screenshot input handling (Bedrock Converse supports image blocks; not wired up here).
- `Task` subagents can't spawn further subagents (one level of nesting only) and currently run one at a time, not in parallel with each other.
- Token-usage estimates used for compaction are a rough `chars/4` heuristic, not a model-specific tokenizer.
