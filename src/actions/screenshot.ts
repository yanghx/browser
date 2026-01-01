import type { ActionHandler } from "./types.js";
import { extractImage } from "../formatters/json-cleaner.js";

export const screenshotAction: ActionHandler = async (request, ctx) => {
  try {
    const opts: Record<string, any> = {};
    if (request.output) opts.filePath = request.output;
    if (request.target) opts.uid = request.target;

    const result = await ctx.chrome.callTool("take_screenshot", opts);
    const imageData = extractImage(result);

    return {
      success: true,
      action: "screenshot",
      data: {
        screenshot: imageData || undefined,
        content: request.output ? `Screenshot saved to ${request.output}` : "Screenshot captured",
      },
    };
  } catch (err: any) {
    return { success: false, action: "screenshot", error: err.message || String(err) };
  }
};
