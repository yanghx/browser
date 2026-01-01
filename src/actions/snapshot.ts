import type { ActionHandler } from "./types.js";
import { extractText } from "../formatters/json-cleaner.js";
import { parseSnapshot, getInteractiveElements } from "../formatters/snapshot-parser.js";

export const snapshotAction: ActionHandler = async (_request, ctx) => {
  try {
    const result = await ctx.chrome.callTool("take_snapshot", {});
    const raw = extractText(result);
    const snapshot = parseSnapshot(raw);
    ctx.state.setCachedSnapshot(snapshot);

    const interactive = getInteractiveElements(snapshot);

    return {
      success: true,
      action: "snapshot",
      data: {
        content: raw,
        elements: interactive.map((el) => ({
          uid: el.uid,
          role: el.role,
          name: el.name,
        })),
      },
    };
  } catch (err: any) {
    return { success: false, action: "snapshot", error: err.message || String(err) };
  }
};
