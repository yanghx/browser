import type { ActionHandler } from "./types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const networkAction: ActionHandler = async (request, ctx) => {
  try {
    const opts: Record<string, any> = { includePreservedRequests: true };
    if (request.resourceTypes) opts.resourceTypes = request.resourceTypes;

    const result = await ctx.chrome.callTool("list_network_requests", opts);
    const text = extractText(result);

    const parsed = extractJson(text);
    let requests: any[] = Array.isArray(parsed) ? parsed : parsed?.networkRequests || parsed?.requests || [];

    // Apply URL pattern filter
    if (request.urlPattern) {
      let re: RegExp;
      try {
        re = new RegExp(request.urlPattern, "i");
      } catch {
        return { success: false, action: "network", error: `Invalid URL pattern regex: "${request.urlPattern}"` };
      }
      requests = requests.filter((r: any) => re.test(r.url || ""));
    }

    // Simplify to essential fields
    const simplified = requests.slice(0, 50).map((r: any) => ({
      url: r.url || "",
      method: r.method || "GET",
      status: r.status || 0,
      type: r.resourceType || r.type || "",
      size: r.responseSize || r.size || 0,
      duration: r.duration || 0,
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
