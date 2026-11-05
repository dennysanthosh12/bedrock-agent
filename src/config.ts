import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";

const DEFAULT_CONFIG: AgentConfig = {
  region: "us-east-1",
  profile: null,
  modelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
  permissionMode: "default",
  maxTokens: 4096,
  maxAgentIterations: 50,
  compactionThresholdTokens: 80_000,
  streaming: true,
};

export function loadConfig(cwd: string): AgentConfig {
  const configPath = join(cwd, ".agent", "config.json");
  let fileConfig: Partial<AgentConfig> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      console.error(`Warning: failed to parse ${configPath}: ${(err as Error).message}`);
    }
  }

  const env = process.env;
  const config: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    region: env.AWS_REGION ?? env.AGENT_REGION ?? fileConfig.region ?? DEFAULT_CONFIG.region,
    profile: env.AWS_PROFILE ?? fileConfig.profile ?? DEFAULT_CONFIG.profile,
    modelId: env.AGENT_MODEL_ID ?? fileConfig.modelId ?? DEFAULT_CONFIG.modelId,
    permissionMode: (env.AGENT_PERMISSION_MODE as AgentConfig["permissionMode"]) ?? fileConfig.permissionMode ?? DEFAULT_CONFIG.permissionMode,
    streaming: env.AGENT_STREAMING ? env.AGENT_STREAMING !== "false" : fileConfig.streaming ?? DEFAULT_CONFIG.streaming,
  };

  return config;
}
