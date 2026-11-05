import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
  type Tool,
  type ToolConfiguration,
  type ContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { AgentConfig } from "../types.js";

export interface ConverseToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ConverseResult {
  stopReason: string | undefined;
  message: Message;
  usage?: { inputTokens?: number; outputTokens?: number };
}

function buildToolConfig(tools: ConverseToolSpec[]): ToolConfiguration | undefined {
  if (!tools.length) return undefined;
  return {
    tools: tools.map(
      (t): Tool => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.inputSchema as any },
        },
      })
    ),
  };
}

export class BedrockAgentClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private maxTokens: number;

  constructor(config: AgentConfig) {
    this.client = new BedrockRuntimeClient({
      region: config.region,
      ...(config.profile ? { profile: config.profile } : {}),
    });
    this.modelId = config.modelId;
    this.maxTokens = config.maxTokens;
  }

  async converse(
    messages: Message[],
    systemPrompt: string,
    tools: ConverseToolSpec[]
  ): Promise<ConverseResult> {
    const command = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: systemPrompt }],
      messages,
      toolConfig: buildToolConfig(tools),
      inferenceConfig: { maxTokens: this.maxTokens, temperature: 0.3 },
    });

    const response = await this.client.send(command);
    if (!response.output?.message) {
      throw new Error("Bedrock Converse returned no message output");
    }
    return {
      stopReason: response.stopReason,
      message: response.output.message,
      usage: response.usage
        ? { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens }
        : undefined,
    };
  }

  /** Streams the response, invoking onTextDelta as text chunks arrive, and returns the assembled message. */
  async converseStream(
    messages: Message[],
    systemPrompt: string,
    tools: ConverseToolSpec[],
    onTextDelta: (chunk: string) => void
  ): Promise<ConverseResult> {
    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: systemPrompt }],
      messages,
      toolConfig: buildToolConfig(tools),
      inferenceConfig: { maxTokens: this.maxTokens, temperature: 0.3 },
    });

    const response = await this.client.send(command);
    const blocks: ContentBlock[] = [];
    let currentText = "";
    let currentToolUse: { toolUseId: string; name: string; inputJson: string } | null = null;
    let stopReason: string | undefined;
    let usage: ConverseResult["usage"];

    if (!response.stream) throw new Error("Bedrock ConverseStream returned no stream");

    for await (const event of response.stream) {
      if (event.contentBlockStart?.start?.toolUse) {
        const tu = event.contentBlockStart.start.toolUse;
        currentToolUse = { toolUseId: tu.toolUseId!, name: tu.name!, inputJson: "" };
      } else if (event.contentBlockDelta?.delta?.text) {
        const text = event.contentBlockDelta.delta.text;
        currentText += text;
        onTextDelta(text);
      } else if (event.contentBlockDelta?.delta?.toolUse?.input) {
        if (currentToolUse) currentToolUse.inputJson += event.contentBlockDelta.delta.toolUse.input;
      } else if (event.contentBlockStop) {
        if (currentToolUse) {
          let input: any = {};
          try {
            input = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {};
          } catch {
            input = {};
          }
          blocks.push({ toolUse: { toolUseId: currentToolUse.toolUseId, name: currentToolUse.name, input } });
          currentToolUse = null;
        } else if (currentText) {
          blocks.push({ text: currentText });
          currentText = "";
        }
      } else if (event.messageStop) {
        stopReason = event.messageStop.stopReason;
      } else if (event.metadata?.usage) {
        usage = {
          inputTokens: event.metadata.usage.inputTokens,
          outputTokens: event.metadata.usage.outputTokens,
        };
      }
    }

    return { stopReason, message: { role: "assistant", content: blocks }, usage };
  }
}
