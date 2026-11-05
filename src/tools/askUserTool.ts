import type { ToolDefinition } from "../types.js";

export const askUserQuestionTool: ToolDefinition = {
  name: "AskUserQuestion",
  description:
    "Ask the user to choose between options when genuinely blocked on a decision only they can make. Do not use for things answerable from the code or request.",
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            header: { type: "string", description: "Short label, max 12 chars" },
            multiSelect: { type: "boolean" },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: { label: { type: "string" }, description: { type: "string" } },
                required: ["label"],
              },
            },
          },
          required: ["question", "options"],
        },
      },
    },
    required: ["questions"],
  },
  needsApproval: () => false,
  async execute(input, ctx) {
    const answers: Record<string, string[]> = {};
    for (const q of input.questions) {
      const chosen = await ctx.askUser(q.question, q.options, Boolean(q.multiSelect));
      answers[q.question] = chosen;
    }
    return { content: JSON.stringify(answers, null, 2) };
  },
};
