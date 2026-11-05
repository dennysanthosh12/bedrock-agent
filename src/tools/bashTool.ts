import { spawn } from "node:child_process";
import type { ToolDefinition } from "../types.js";

const SAFE_READONLY = /^(ls|dir|pwd|cat|type|git status|git log|git diff|git branch|echo|node -v|npm -v)\b/i;

export const bashTool: ToolDefinition = {
  name: "Bash",
  description:
    "Execute a shell command (PowerShell on Windows) and return stdout/stderr. Use for builds, tests, git, etc. " +
    "Set run_in_background:true for long-running processes (dev servers, watch tasks); poll its output with BashOutput and stop it with KillShell.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout: { type: "number", description: "Timeout in ms, default 120000 (ignored if run_in_background)" },
      description: { type: "string", description: "Short description of what the command does" },
      run_in_background: { type: "boolean", description: "Run asynchronously and return a job id immediately" },
    },
    required: ["command"],
  },
  needsApproval: (input) => !SAFE_READONLY.test(input.command.trim()),
  async execute(input, ctx) {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "powershell.exe" : "bash";
    const args = isWindows
      ? ["-NoProfile", "-NonInteractive", "-Command", input.command]
      : ["-c", input.command];

    if (input.run_in_background) {
      const child = spawn(cmd, args, { cwd: ctx.cwd });
      const job = ctx.jobs.create(input.command, child);
      return { content: `Started background job ${job.id}: ${input.command}` };
    }

    const timeout = input.timeout ?? 120_000;
    return new Promise((resolvePromise) => {
      const child = spawn(cmd, args, { cwd: ctx.cwd });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        resolvePromise({ content: `Error: command timed out after ${timeout}ms`, isError: true });
      }, timeout);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        clearTimeout(timer);
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        resolvePromise({
          content: output || "(no output)",
          isError: code !== 0,
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise({ content: `Error: ${err.message}`, isError: true });
      });
    });
  },
};

export const bashOutputTool: ToolDefinition = {
  name: "BashOutput",
  description: "Retrieve new stdout/stderr output (and status) from a background shell job started by Bash.",
  inputSchema: {
    type: "object",
    properties: { bash_id: { type: "string" } },
    required: ["bash_id"],
  },
  readOnly: true,
  needsApproval: () => false,
  async execute(input, ctx) {
    const job = ctx.jobs.get(input.bash_id);
    if (!job) return { content: `Error: no job ${input.bash_id}`, isError: true };
    const drained = ctx.jobs.drain(input.bash_id)!;
    const lines = [
      `status: ${job.status}${job.exitCode !== null ? ` (exit ${job.exitCode})` : ""}`,
      drained.stdout && `stdout:\n${drained.stdout}`,
      drained.stderr && `stderr:\n${drained.stderr}`,
    ].filter(Boolean);
    return { content: lines.join("\n") || "(no new output)" };
  },
};

export const killShellTool: ToolDefinition = {
  name: "KillShell",
  description: "Terminate a background shell job started by Bash.",
  inputSchema: {
    type: "object",
    properties: { bash_id: { type: "string" } },
    required: ["bash_id"],
  },
  needsApproval: () => true,
  async execute(input, ctx) {
    const ok = ctx.jobs.kill(input.bash_id);
    return ok
      ? { content: `Killed ${input.bash_id}` }
      : { content: `Error: no job ${input.bash_id}`, isError: true };
  },
};
