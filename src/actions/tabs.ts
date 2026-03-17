import type { ActionHandler } from "./types.js";
import { parsePagesText } from "../page-manager.js";
import { extractText } from "../formatters/json-cleaner.js";

export const tabListAction: ActionHandler = async (_request, ctx) => {
  try {
    const result = await ctx.chrome.callTool("list_pages", {});
    const tabs = parsePagesText(extractText(result));

    return {
      success: true,
      action: "tab_list",
      data: {
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
        })),
        content: `${tabs.length} tabs open`,
      },
    };
  } catch (err: any) {
    return { success: false, action: "tab_list", error: err.message || String(err) };
  }
};

export const tabNewAction: ActionHandler = async (request, ctx) => {
  const url = request.url;
  if (!url) return { success: false, action: "tab_new", error: "url is required" };

  try {
    ctx.state.invalidateCache();
    await ctx.chrome.callTool("new_page", { url });
    return {
      success: true,
      action: "tab_new",
      data: { url, content: `Opened new tab: ${url}` },
    };
  } catch (err: any) {
    return { success: false, action: "tab_new", error: err.message || String(err) };
  }
};

export const tabSelectAction: ActionHandler = async (request, ctx) => {
  const pageId = request.tabId;
  if (pageId === undefined) return { success: false, action: "tab_select", error: "tabId is required" };

  try {
    ctx.state.invalidateCache();
    await ctx.chrome.callTool("select_page", { pageId });
    return {
      success: true,
      action: "tab_select",
      data: { content: `Switched to tab ${pageId}` },
    };
  } catch (err: any) {
    return { success: false, action: "tab_select", error: err.message || String(err) };
  }
};
