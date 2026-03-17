import type { ActionHandler } from "./types.js";
import { extractText } from "../formatters/json-cleaner.js";

/** Parse Chrome DevTools MCP text format: "reqid=N METHOD URL [STATUS]" */
function parseNetworkRequests(text: string): Array<{
  url: string; method: string; status: number;
}> {
  const requests: Array<{ url: string; method: string; status: number }> = [];
  for (const line of text.split("\n")) {
    const m = line.match(/reqid=(\d+)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+\[(\d+|pending)\]/i);
    if (!m) continue;
    requests.push({
      method: m[2].toUpperCase(),
      url: m[3],
      status: m[4] === "pending" ? 0 : parseInt(m[4]),
    });
  }
  return requests;
}

export const networkAction: ActionHandler = async (request, ctx) => {
  try {
    const result = await ctx.chrome.callTool("list_network_requests", {});
    const text = extractText(result);
    let requests = parseNetworkRequests(text);

    // Apply URL pattern filter
    if (request.urlPattern) {
      let re: RegExp;
      try {
        re = new RegExp(request.urlPattern, "i");
      } catch {
        return { success: false, action: "network", error: `Invalid URL pattern regex: "${request.urlPattern}"` };
      }
      requests = requests.filter((r) => re.test(r.url));
    }

    const simplified = requests.slice(0, 50).map((r) => ({
      url: r.url,
      method: r.method,
      status: r.status,
      type: "fetch",
      size: 0,
      duration: 0,
    }));

    return {
      success: true,
      action: "network",
      data: {
        requests: simplified,
        content: `${simplified.length} network requests${request.urlPattern ? ` matching "${request.urlPattern}"` : ""}`,
      },
    };
  } catch (err: any) {
    return { success: false, action: "network", error: err.message || String(err) };
  }
};
