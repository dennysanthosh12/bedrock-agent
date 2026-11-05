import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import type { ToolDefinition } from "../types.js";
import { lineDiff } from "../utils/diff.js";

function toAbs(cwd: string, p: string): string {
  return resolve(cwd, p);
}

export const readTool: ToolDefinition = {
  name: "Read",
  description:
    "Read a text file from the local filesystem. Returns content with line numbers. Use offset/limit for large files.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute or cwd-relative path to the file" },
      offset: { type: "number", description: "1-indexed line to start from" },
      limit: { type: "number", description: "Max number of lines to read" },
    },
    required: ["file_path"],
  },
  readOnly: true,
  needsApproval: () => false,
  async execute(input, ctx) {
    const path = toAbs(ctx.cwd, input.file_path);
    if (!existsSync(path)) {
      return { content: `Error: file not found: ${path}`, isError: true };
    }
    const raw = readFileSync(path, "utf-8");
    const lines = raw.split(/\r?\n/);
    const offset = input.offset ? Math.max(1, input.offset) : 1;
    const limit = input.limit ?? 2000;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");
    return { content: numbered || "(empty file)" };
  },
};

export const writeTool: ToolDefinition = {
  name: "Write",
  description: "Write (create or overwrite) a file with the given content.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      content: { type: "string" },
    },
    required: ["file_path", "content"],
  },
  needsApproval: () => true,
  async execute(input, ctx) {
    const path = toAbs(ctx.cwd, input.file_path);
    const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
    ctx.checkpoints.record(path, "Write");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, input.content, "utf-8");
    const diff = lineDiff(before, input.content);
    return { content: `Wrote ${input.content.length} bytes to ${path}\n${diff}` };
  },
};

export const editTool: ToolDefinition = {
  name: "Edit",
  description:
    "Perform an exact string replacement in a file. old_string must match exactly once unless replace_all is set.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  needsApproval: () => true,
  async execute(input, ctx) {
    const path = toAbs(ctx.cwd, input.file_path);
    if (!existsSync(path)) {
      return { content: `Error: file not found: ${path}`, isError: true };
    }
    const raw = readFileSync(path, "utf-8");
    const count = raw.split(input.old_string).length - 1;
    if (count === 0) {
      return { content: "Error: old_string not found in file", isError: true };
    }
    if (count > 1 && !input.replace_all) {
      return {
        content: `Error: old_string matches ${count} times; pass replace_all or provide more context`,
        isError: true,
      };
    }
    const updated = input.replace_all
      ? raw.split(input.old_string).join(input.new_string)
      : raw.replace(input.old_string, input.new_string);
    ctx.checkpoints.record(path, "Edit");
    writeFileSync(path, updated, "utf-8");
    const diff = lineDiff(raw, updated);
    return { content: `Edited ${path} (${count} replacement${count > 1 ? "s" : ""})\n${diff}` };
  },
};

export const undoTool: ToolDefinition = {
  name: "Undo",
  description: "Revert the most recent file-mutating tool calls (Write/Edit) from this session, restoring prior content.",
  inputSchema: {
    type: "object",
    properties: { count: { type: "number", description: "How many recent mutations to undo, default 1" } },
  },
  needsApproval: () => true,
  async execute(input, ctx) {
    const restored = ctx.checkpoints.undo(input.count ?? 1);
    return { content: restored.length ? restored.join("\n") : "Nothing to undo" };
  },
};

export const globTool: ToolDefinition = {
  name: "Glob",
  description: "Find files matching a glob pattern, sorted by modification time.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Directory to search in, defaults to cwd" },
    },
    required: ["pattern"],
  },
  readOnly: true,
  needsApproval: () => false,
  async execute(input, ctx) {
    const base = input.path ? toAbs(ctx.cwd, input.path) : ctx.cwd;
    const matches = await fg(input.pattern, { cwd: base, absolute: true, onlyFiles: true, dot: true });
    return { content: matches.length ? matches.join("\n") : "(no matches)" };
  },
};

export const grepTool: ToolDefinition = {
  name: "Grep",
  description: "Search file contents for a regex pattern across files matching a glob.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      glob: { type: "string", description: "Glob of files to search, default **/*" },
      path: { type: "string" },
      ignoreCase: { type: "boolean" },
    },
    required: ["pattern"],
  },
  readOnly: true,
  needsApproval: () => false,
  async execute(input, ctx) {
    const base = input.path ? toAbs(ctx.cwd, input.path) : ctx.cwd;
    const files = await fg(input.glob ?? "**/*", {
      cwd: base,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    });
    const re = new RegExp(input.pattern, input.ignoreCase ? "i" : "");
    const results: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (re.test(line)) results.push(`${file}:${i + 1}:${line}`);
      });
      if (results.length > 500) break;
    }
    return { content: results.length ? results.join("\n") : "(no matches)" };
  },
};
