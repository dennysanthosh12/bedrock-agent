import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "../types.js";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

function loadMcpConfig(cwd: string): McpConfigFile {
  const path = join(cwd, ".agent", "mcp.json");
  if (!existsSync(path)) return { mcpServers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { mcpServers: {} };
  }
}

export class McpManager {
  private clients = new Map<string, Client>();

  async connectAll(cwd: string): Promise<void> {
    const { mcpServers } = loadMcpConfig(cwd);
    for (const [serverName, cfg] of Object.entries(mcpServers)) {
      try {
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
        });
        const client = new Client({ name: "bedrock-agent", version: "0.1.0" }, { capabilities: {} });
        await client.connect(transport);
        this.clients.set(serverName, client);
        console.error(`[mcp] connected: ${serverName}`);
      } catch (err) {
        console.error(`[mcp] failed to connect ${serverName}: ${(err as Error).message}`);
      }
    }
  }

  async getToolDefinitions(): Promise<ToolDefinition[]> {
    const defs: ToolDefinition[] = [];
    for (const [serverName, client] of this.clients) {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        defs.push({
          name: `mcp__${serverName}__${tool.name}`,
          description: tool.description ?? `Tool ${tool.name} from MCP server ${serverName}`,
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
          needsApproval: () => true,
          execute: async (input) => {
            const result = await client.callTool({ name: tool.name, arguments: input });
            const content = Array.isArray(result.content)
              ? result.content
                  .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
                  .join("\n")
              : JSON.stringify(result.content);
            return { content, isError: Boolean(result.isError) };
          },
        });
      }
    }
    return defs;
  }

  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close().catch(() => {});
    }
  }
}
