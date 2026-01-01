import type { ActionHandler } from "./types.js";
import { resolveTarget } from "../utils/uid-resolver.js";

export const selectAction: ActionHandler = async (request, ctx) => {
  const { target, value } = request;
  if (!target) return { success: false, action: "select", error: "target is required" };
  if (!value) return { success: false, action: "select", error: "value is required" };

  try {
    const uid = await resolveTarget(target, ctx);
    ctx.state.invalidateCache();
    // Chrome MCP fill works for select elements too
    await ctx.chrome.callTool("fill", { uid, value });
    return {
      success: true,
      action: "select",
      data: { content: `Selected "${value}" in "${target}" (uid: ${uid})` },
    };
  } catch (err: any) {
    return { success: false, action: "select", error: err.message || String(err) };
  }
};
