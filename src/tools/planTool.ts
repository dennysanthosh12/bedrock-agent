import type { ToolDefinition } from "../types.js";

export const enterPlanModeTool: ToolDefinition = {
  name: "EnterPlanMode",
  description:
    "Switch into plan mode: research and design an approach without making any changes. All mutating tools will be blocked until ExitPlanMode is approved.",
  inputSchema: { type: "object", properties: {} },
  needsApproval: () => false,
  async execute(_input, ctx) {
    ctx.setPermissionMode("plan");
    return { content: "Entered plan mode. Investigate and draft a plan; call ExitPlanMode with the plan when ready." };
  },
};

export const exitPlanModeTool: ToolDefinition = {
  name: "ExitPlanMode",
  description:
    "Present the finished plan to the user for approval. If approved, exits plan mode and returns to normal execution.",
  inputSchema: {
    type: "object",
    properties: {
      plan: { type: "string", description: "The plan, in markdown, to present for approval" },
    },
    required: ["plan"],
  },
  needsApproval: () => false,
  async execute(input, ctx) {
    console.log("\n" + input.plan + "\n");
    const approved = await ctx.requestApproval("Proceed with this plan?", input.plan);
    if (approved) {
      ctx.setPermissionMode("default");
      return { content: "Plan approved. Exited plan mode; you may now execute it." };
    }
    return { content: "Plan not approved. Remain in plan mode and revise it based on any feedback given." };
  },
};
