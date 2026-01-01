import type { ActionHandler } from "./types.js";
import { resolveTarget } from "../utils/uid-resolver.js";

export const typeAction: ActionHandler = async (request, ctx) => {
  const { target, value } = request;
  if (!value) return { success: false, action: "type", error: "value is required" };

  try {
    // If target specified, click it first to focus
    if (target) {
      const uid = await resolveTarget(target, ctx);
      await ctx.chrome.callTool("click", { uid });
      await new Promise((r) => setTimeout(r, 100));
    }

    ctx.state.invalidateCache();
    await ctx.chrome.callTool("type_text", { text: value });

    return {
      success: true,
      action: "type",
      data: { content: `Typed "${value}"${target ? ` into "${target}"` : ""}` },
    };
  } catch (err: any) {
    return { success: false, action: "type", error: err.message || String(err) };
  }
};
