import type { ActionHandler } from "./types.js";
import { DATA_EXTRACTOR_SCRIPT } from "../scripts/page-extractor.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";
import { toMarkdownTable } from "../formatters/markdown.js";

export const extractAction: ActionHandler = async (request, ctx) => {
  const selector = request.selector || request.target;
  if (!selector) return { success: false, action: "extract", error: "selector is required" };

  try {
    // Chrome DevTools MCP requires a snapshot before evaluate_script works
    if (!ctx.state.getCachedSnapshot()) {
      await ctx.chrome.callTool("take_snapshot", {});
    }

    const result = await ctx.chrome.callTool("evaluate_script", {
      function: DATA_EXTRACTOR_SCRIPT,
      args: [selector],
    });

    const text = extractText(result);
    const extracted: any = extractJson(text) || {};

    const format = request.format || "json";

    let content: string;
    if (format === "markdown" && extracted.type === "table" && Array.isArray(extracted.data)) {
      content = toMarkdownTable(extracted.data);
    } else if (format === "csv" && extracted.type === "table" && Array.isArray(extracted.data)) {
      const rows = extracted.data as Record<string, any>[];
      if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        const csvRows = [keys.join(","), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","))];
        content = csvRows.join("\n");
      } else {
        content = "(empty)";
      }
    } else {
      content = JSON.stringify(extracted.data, null, 2);
    }

    return {
      success: true,
      action: "extract",
      data: {
        content,
        items: extracted.data ? (Array.isArray(extracted.data) ? extracted.data : [extracted.data]) : [],
      },
    };
  } catch (err: any) {
    return { success: false, action: "extract", error: err.message || String(err) };
  }
};
