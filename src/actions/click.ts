import type { ActionHandler } from "./types.js";
import { resolveTarget } from "../utils/uid-resolver.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const clickAction: ActionHandler = async (request, ctx) => {
  const { target } = request;
  if (!target) {
    return { success: false, action: "click", error: "target is required" };
  }

  try {
    const uid = await resolveTarget(target, ctx);
    ctx.state.invalidateCache();

    await ctx.chrome.callTool("click", { uid });

    // Brief wait for page to stabilize
    await new Promise((r) => setTimeout(r, 300));

    // Get updated page info
    const pageInfo = await ctx.chrome.callTool("evaluate_script", {
      function: `() => ({ title: document.title, url: location.href })`,
    });
    const text = extractText(pageInfo);
    const info = extractJson(text) || { title: "", url: "" };

    return {
      success: true,
      action: "click",
      data: {
        title: info.title,
        url: info.url,
        content: `Clicked element "${target}" (uid: ${uid})`,
      },
    };
  } catch (err: any) {
    return { success: false, action: "click", error: err.message || String(err) };
  }
};
