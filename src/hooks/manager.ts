import { spawn } from "node:child_process";
import chalk from "chalk";
import type { HookDefinition, HookEventName, SettingsConfig } from "../types.js";

export interface HookPayload {
  event: HookEventName;
  cwd: string;
  toolName?: string;
  input?: unknown;
  prompt?: string;
}

export interface HookVerdict {
  blocked: boolean;
  reason?: string;
}

function runOne(def: HookDefinition, payload: HookPayload): Promise<HookVerdict> {
  return new Promise((resolvePromise) => {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "powershell.exe" : "bash";
    const args = isWindows ? ["-NoProfile", "-NonInteractive", "-Command", def.command] : ["-c", def.command];
    const child = spawn(cmd, args, { cwd: payload.cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", () => resolvePromise({ blocked: false }));
    child.on("close", (code) => {
      if (code !== 0) {
        resolvePromise({ blocked: true, reason: `hook "${def.command}" exited ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.decision === "block") {
          resolvePromise({ blocked: true, reason: parsed.reason ?? "blocked by hook" });
          return;
        }
      } catch {
        // non-JSON stdout is fine; treated as "allow"
      }
      resolvePromise({ blocked: false });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/** Runs all hooks registered for an event whose matcher matches the tool name (if any). Returns the first block verdict found. */
export async function runHooks(
  settings: SettingsConfig,
  event: HookEventName,
  payload: HookPayload
): Promise<HookVerdict> {
  const defs = settings.hooks[event] ?? [];
  const applicable = defs.filter((d) => !d.matcher || !payload.toolName || new RegExp(d.matcher).test(payload.toolName));
  for (const def of applicable) {
    const verdict = await runOne(def, payload);
    if (verdict.blocked) {
      console.log(chalk.red(`[hook:${event}] blocked — ${verdict.reason}`));
      return verdict;
    }
  }
  return { blocked: false };
}
