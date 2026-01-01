import type {
  ActionHandler,
  BrowserActionRequest,
  BrowserActionResponse,
  ActionContext,
} from "./types.js";
import { PAGE_EXTRACTOR_SCRIPT } from "../scripts/page-extractor.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";
import { toMarkdown } from "../formatters/markdown.js";
import { parseSnapshot, getInteractiveElements } from "../formatters/snapshot-parser.js";
import { ensureDomainTab } from "../page-manager.js";

export const browseAction: ActionHandler = async (
  request: BrowserActionRequest,
  ctx: ActionContext
): Promise<BrowserActionResponse> => {
  const { url, waitFor } = request;
  if (!url) {
    return { success: false, action: "browse", error: "url is required" };
  }

  try {
    // 1. Reuse existing tab for this domain, or create one
    try {
      const domain = new URL(url).hostname;
      await ensureDomainTab(ctx.chrome, ctx.state, domain, { url, skipWait: true });
    } catch {
      // Fallback: if URL parsing fails, just navigate current tab
    }
    await ctx.chrome.callTool("navigate_page", { type: "url", url });

    // 2. Wait if specified
    if (waitFor) {
      await ctx.chrome.callTool("wait_for", { text: [waitFor], timeout: 10000 });
    }

    // 3. Extract page content via JS injection
    const extractResult = await ctx.chrome.callTool("evaluate_script", {
      function: PAGE_EXTRACTOR_SCRIPT,
    });
    const extractText_ = extractText(extractResult);
    let pageData: any = extractJson(extractText_);
    if (!pageData) {
      pageData = { title: "", url, content: extractText_ };
    }

    // 4. Take snapshot and cache it
    const snapshotResult = await ctx.chrome.callTool("take_snapshot", {});
    const snapshotRaw = extractText(snapshotResult);
    const snapshot = parseSnapshot(snapshotRaw);
    ctx.state.setCachedSnapshot(snapshot);

    // 5. Format response
    const content = toMarkdown(pageData);
    const interactive = getInteractiveElements(snapshot);

    return {
      success: true,
      action: "browse",
      data: {
        title: pageData.title || "",
        url: pageData.url || url,
        content,
        elements: interactive.slice(0, 30).map((el) => ({
          uid: el.uid,
          role: el.role,
          name: el.name,
        })),
      },
    };
  } catch (err: any) {
    return {
      success: false,
      action: "browse",
      error: err.message || String(err),
    };
  }
};
