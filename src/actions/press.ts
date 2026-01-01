import type { ActionHandler } from "./types.js";

export const pressAction: ActionHandler = async (request, ctx) => {
  const key = request.value || request.target;
  if (!key) return { success: false, action: "press", error: "key (value or target) is required" };

  try {
    ctx.state.invalidateCache();
    await ctx.chrome.callTool("press_key", { key });
    return {
      success: true,
      action: "press",
      data: { content: `Pressed key "${key}"` },
    };
  } catch (err: any) {
    return { success: false, action: "press", error: err.message || String(err) };
  }
};
