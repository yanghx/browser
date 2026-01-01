import type { ActionHandler } from "./types.js";
import { resolveTarget } from "../utils/uid-resolver.js";

export const hoverAction: ActionHandler = async (request, ctx) => {
  const { target } = request;
  if (!target) return { success: false, action: "hover", error: "target is required" };

  try {
    const uid = await resolveTarget(target, ctx);
    await ctx.chrome.callTool("hover", { uid });
    return {
      success: true,
      action: "hover",
      data: { content: `Hovered over "${target}" (uid: ${uid})` },
    };
  } catch (err: any) {
    return { success: false, action: "hover", error: err.message || String(err) };
  }
};
