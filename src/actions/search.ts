import type { ActionHandler } from "./types.js";
import { extractText } from "../formatters/json-cleaner.js";
import { parseSnapshot } from "../formatters/snapshot-parser.js";

export const searchAction: ActionHandler = async (request, ctx) => {
  const query = request.target || request.selector;
  if (!query) return { success: false, action: "search", error: "target (search query) is required" };

  try {
    const result = await ctx.chrome.callTool("take_snapshot", { verbose: true });
    const raw = extractText(result);
    const snapshot = parseSnapshot(raw);
    ctx.state.setCachedSnapshot(snapshot);

    const lower = query.toLowerCase();
    const matches = snapshot.elements.filter(
      (el) =>
        el.name.toLowerCase().includes(lower) ||
        el.text.toLowerCase().includes(lower) ||
        el.role.toLowerCase().includes(lower)
    );

    return {
      success: true,
      action: "search",
      data: {
        content: `Found ${matches.length} elements matching "${query}"`,
        elements: matches.slice(0, 30).map((el) => ({
          uid: el.uid,
          role: el.role,
          name: el.name,
        })),
      },
    };
  } catch (err: any) {
    return { success: false, action: "search", error: err.message || String(err) };
  }
};
