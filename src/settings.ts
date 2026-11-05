import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SettingsConfig } from "./types.js";

const DEFAULT_SETTINGS: SettingsConfig = {
  permissions: { allow: [], deny: [], ask: [] },
  hooks: {},
};

function mergeSettings(base: SettingsConfig, override: Partial<SettingsConfig>): SettingsConfig {
  return {
    permissions: {
      allow: [...base.permissions.allow, ...(override.permissions?.allow ?? [])],
      deny: [...base.permissions.deny, ...(override.permissions?.deny ?? [])],
      ask: [...base.permissions.ask, ...(override.permissions?.ask ?? [])],
    },
    hooks: { ...base.hooks, ...(override.hooks ?? {}) },
  };
}

function readSettingsFile(path: string): Partial<SettingsConfig> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`Warning: failed to parse ${path}: ${(err as Error).message}`);
    return {};
  }
}

/**
 * Loads project .agent/settings.json, then .agent/settings.local.json (gitignored, personal
 * overrides), merging permission lists and hooks — mirroring Claude Code's settings layering.
 */
export function loadSettings(cwd: string): SettingsConfig {
  const project = readSettingsFile(join(cwd, ".agent", "settings.json"));
  const local = readSettingsFile(join(cwd, ".agent", "settings.local.json"));
  return mergeSettings(mergeSettings(DEFAULT_SETTINGS, project), local);
}
