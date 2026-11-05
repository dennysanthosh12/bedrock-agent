import chalk from "chalk";
import type { ToolDefinition } from "../types.js";

export interface TodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

let todos: TodoItem[] = [];

export function getTodos(): TodoItem[] {
  return todos;
}

export function renderTodos(): string {
  if (!todos.length) return "(no todos)";
  return todos
    .map((t) => {
      const icon = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      const label = t.status === "in_progress" ? t.activeForm : t.content;
      return `${icon} ${label}`;
    })
    .join("\n");
}

export const todoWriteTool: ToolDefinition = {
  name: "TodoWrite",
  description:
    "Create/update a structured task list to track progress on multi-step work. Pass the FULL list every time (not a diff). " +
    "Exactly one item should be in_progress at a time. Use for tasks with 3+ distinct steps; skip for trivial single-step requests.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Imperative form, e.g. 'Run tests'" },
            activeForm: { type: "string", description: "Present-continuous form, e.g. 'Running tests'" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "activeForm", "status"],
        },
      },
    },
    required: ["todos"],
  },
  needsApproval: () => false,
  readOnly: false,
  async execute(input) {
    todos = input.todos;
    console.log(chalk.magenta("\nTodos:"));
    console.log(chalk.magenta(renderTodos()));
    return { content: `Updated ${todos.length} todo(s)` };
  },
};
