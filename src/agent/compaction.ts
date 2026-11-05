import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { BedrockAgentClient } from "../bedrock/client.js";

/** Rough token estimate (chars/4) — good enough for a soft compaction trigger across arbitrary Bedrock models. */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const block of m.content ?? []) {
      if ("text" in block && block.text) chars += block.text.length;
      if ("toolUse" in block && block.toolUse) chars += JSON.stringify(block.toolUse.input ?? {}).length;
      if ("toolResult" in block && block.toolResult) {
        for (const c of block.toolResult.content ?? []) {
          if ("text" in c && c.text) chars += c.text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

function flattenToText(m: Message): string {
  const role = m.role === "assistant" ? "Assistant" : "User";
  const parts = (m.content ?? []).map((block) => {
    if ("text" in block && block.text) return block.text;
    if ("toolUse" in block && block.toolUse) return `[called tool ${block.toolUse.name} with ${JSON.stringify(block.toolUse.input)}]`;
    if ("toolResult" in block && block.toolResult) {
      const text = (block.toolResult.content ?? []).map((c: any) => c.text).join(" ");
      return `[tool result: ${text.slice(0, 500)}]`;
    }
    return "";
  });
  return `${role}: ${parts.join(" ").trim()}`;
}

/**
 * Summarizes the oldest messages into one synthetic exchange, keeping the most recent
 * `keepRecent` messages verbatim. Mirrors Claude Code's auto-compaction.
 */
export async function compactMessages(
  client: BedrockAgentClient,
  messages: Message[],
  keepRecent = 10
): Promise<Message[]> {
  if (messages.length <= keepRecent) return messages;

  let splitAt = messages.length - keepRecent;
  // keep the retained tail role-valid (must start with "user")
  while (splitAt < messages.length && messages[splitAt].role !== "user") splitAt++;

  const older = messages.slice(0, splitAt);
  const recent = messages.slice(splitAt);
  if (!older.length) return messages;

  const transcript = older.map(flattenToText).join("\n");
  const summaryPrompt =
    "Summarize the following conversation transcript concisely, preserving: the user's goals, " +
    "decisions made, files changed, and any unresolved tasks. Be factual and terse.\n\n" + transcript;

  const result = await client.converse(
    [{ role: "user", content: [{ text: summaryPrompt }] }],
    "You summarize coding-agent conversation transcripts for context compaction.",
    []
  );
  const summaryText = (result.message.content ?? [])
    .filter((b): b is { text: string } => "text" in b)
    .map((b) => b.text)
    .join("\n");

  return [
    { role: "user", content: [{ text: `[Earlier conversation summary]\n${summaryText}` }] },
    { role: "assistant", content: [{ text: "Understood, continuing from that summary." }] },
    ...recent,
  ];
}
