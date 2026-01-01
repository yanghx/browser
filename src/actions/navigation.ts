import type { ActionHandler, ActionContext } from "./types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const backAction: ActionHandler = async (_request, ctx) => {
  try {
    ctx.state.invalidateCache();
    await ctx.chrome.callTool("navigate_page", { type: "back" });
    const info = await getPageInfo(ctx);
    return { success: true, action: "back", data: { ...info, content: "Navigated back" } };
  } catch (err: any) {
    return { success: false, action: "back", error: err.message || String(err) };
  }
};

export const forwardAction: ActionHandler = async (_request, ctx) => {
  try {
    ctx.state.invalidateCache();
    await ctx.chrome.callTool("navigate_page", { type: "forward" });
    const info = await getPageInfo(ctx);
    return { success: true, action: "forward", data: { ...info, content: "Navigated forward" } };
  } catch (err: any) {
    return { success: false, action: "forward", error: err.message || String(err) };
  }
};

export const waitAction: ActionHandler = async (request, ctx) => {
  const text = request.waitFor || request.target || request.value;
  if (!text) return { success: false, action: "wait", error: "waitFor text is required" };

  try {
    await ctx.chrome.callTool("wait_for", { text: [text], timeout: 10000 });
    return { success: true, action: "wait", data: { content: `Text "${text}" appeared on page` } };
  } catch (err: any) {
    return { success: false, action: "wait", error: err.message || String(err) };
  }
};

export const closeAction: ActionHandler = async (request, ctx) => {
  const pageId = request.tabId;
  if (pageId === undefined) return { success: false, action: "close", error: "tabId is required" };

  try {
    await ctx.chrome.callTool("close_page", { pageId });
    return { success: true, action: "close", data: { content: `Closed tab ${pageId}` } };
  } catch (err: any) {
    return { success: false, action: "close", error: err.message || String(err) };
  }
};

async function getPageInfo(ctx: ActionContext): Promise<{ title: string; url: string }> {
  try {
    const result = await ctx.chrome.callTool("evaluate_script", {
      function: `() => ({ title: document.title, url: location.href })`,
    });
    return extractJson(extractText(result)) || { title: "", url: "" };
  } catch {
    return { title: "", url: "" };
  }
}
