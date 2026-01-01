import type { ActionHandler } from "./types.js";
import { resolveTarget } from "../utils/uid-resolver.js";

export const fillAction: ActionHandler = async (request, ctx) => {
  const { target, value } = request;
  if (!target) return { success: false, action: "fill", error: "target is required" };
  if (value === undefined) return { success: false, action: "fill", error: "value is required" };

  try {
    const uid = await resolveTarget(target, ctx);
    ctx.state.invalidateCache();

    await ctx.chrome.callTool("fill", { uid, value });

    return {
      success: true,
      action: "fill",
      data: { content: `Filled "${target}" (uid: ${uid}) with "${value}"` },
    };
  } catch (err: any) {
    return { success: false, action: "fill", error: err.message || String(err) };
  }
};
