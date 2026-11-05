import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@aws-sdk/client-bedrock-runtime";

export interface SessionFile {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

function sessionsDir(cwd: string): string {
  const dir = join(cwd, ".agent", "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveSession(cwd: string, id: string, messages: Message[]): void {
  const dir = sessionsDir(cwd);
  const path = join(dir, `${id}.json`);
  const existing = existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as SessionFile) : null;
  const file: SessionFile = {
    id,
    cwd,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
  writeFileSync(path, JSON.stringify(file, null, 2), "utf-8");
}

export function loadSession(cwd: string, id: string): SessionFile | null {
  const path = join(sessionsDir(cwd), `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Returns the most recently updated session for this cwd, if any. */
export function latestSession(cwd: string): SessionFile | null {
  const dir = sessionsDir(cwd);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  const withTimes = files.map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }));
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return loadSession(cwd, withTimes[0].f.replace(/\.json$/, ""));
}

export function listSessions(cwd: string): SessionFile[] {
  const dir = sessionsDir(cwd);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadSession(cwd, f.replace(/\.json$/, "")))
    .filter((s): s is SessionFile => Boolean(s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
