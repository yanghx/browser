import type { ActionHandler } from "./types.js";

export const scrollAction: ActionHandler = async (request, ctx) => {
  const direction = request.value || request.target || "down";

  try {
    const keyMap: Record<string, string> = {
      down: "PageDown",
      up: "PageUp",
      top: "Home",
      bottom: "End",
    };
    const key = keyMap[direction.toLowerCase()] || "PageDown";
    await ctx.chrome.callTool("press_key", { key });

    return {
      success: true,
      action: "scroll",
      data: { content: `Scrolled ${direction}` },
    };
  } catch (err: any) {
    return { success: false, action: "scroll", error: err.message || String(err) };
  }
};
