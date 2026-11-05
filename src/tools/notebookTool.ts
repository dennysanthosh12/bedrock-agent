import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition } from "../types.js";

interface NbCell {
  cell_type: "code" | "markdown";
  source: string[] | string;
  [k: string]: unknown;
}

function toLines(src: string): string[] {
  const lines = src.split(/\n/);
  return lines.map((l, i) => (i < lines.length - 1 ? l + "\n" : l));
}

export const notebookEditTool: ToolDefinition = {
  name: "NotebookEdit",
  description: "Replace, insert, or delete a cell in a Jupyter notebook (.ipynb) by index.",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: { type: "string" },
      cell_index: { type: "number", description: "0-indexed cell position" },
      new_source: { type: "string", description: "New cell source (omit with edit_mode 'delete')" },
      cell_type: { type: "string", enum: ["code", "markdown"] },
      edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: "default replace" },
    },
    required: ["notebook_path", "cell_index"],
  },
  needsApproval: () => true,
  async execute(input, ctx) {
    const path = resolve(ctx.cwd, input.notebook_path);
    if (!existsSync(path)) return { content: `Error: notebook not found: ${path}`, isError: true };
    const nb = JSON.parse(readFileSync(path, "utf-8"));
    const cells: NbCell[] = nb.cells ?? [];
    const mode = input.edit_mode ?? "replace";
    const idx = input.cell_index;

    if (mode === "delete") {
      if (idx < 0 || idx >= cells.length) return { content: "Error: cell_index out of range", isError: true };
      cells.splice(idx, 1);
    } else if (mode === "insert") {
      const newCell: NbCell = {
        cell_type: input.cell_type ?? "code",
        source: toLines(input.new_source ?? ""),
        metadata: {},
        ...(input.cell_type !== "markdown" ? { outputs: [], execution_count: null } : {}),
      };
      cells.splice(idx, 0, newCell);
    } else {
      if (idx < 0 || idx >= cells.length) return { content: "Error: cell_index out of range", isError: true };
      cells[idx].source = toLines(input.new_source ?? "");
      if (input.cell_type) cells[idx].cell_type = input.cell_type;
    }

    ctx.checkpoints.record(path, "NotebookEdit");
    nb.cells = cells;
    writeFileSync(path, JSON.stringify(nb, null, 1), "utf-8");
    return { content: `${mode} applied at cell ${idx} in ${path} (${cells.length} cells total)` };
  },
};
