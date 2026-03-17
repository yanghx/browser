import type { ActionContext, BrowserActionResponse } from "../actions/types.js";
import { extractText } from "../formatters/json-cleaner.js";

/**
 * Capture and format network requests for API discovery.
 * Shows URL patterns, request/response shapes for building site recipes.
 */
export async function captureNetworkLog(
  _resourceTypes: string[] | undefined,
  urlPattern: string | undefined,
  ctx: ActionContext
): Promise<BrowserActionResponse> {
  const result = await ctx.chrome.callTool("list_network_requests", {});
  const text = extractText(result);

  // Parse Chrome DevTools MCP text format: "reqid=N METHOD URL [STATUS]"
  const requests: Array<{
    reqid: number;
    method: string;
    url: string;
    status: number;
  }> = [];

  for (const line of text.split("\n")) {
    const m = line.match(/reqid=(\d+)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+\[(\d+|pending)\]/i);
    if (!m) continue;
    requests.push({
      reqid: parseInt(m[1]),
      method: m[2].toUpperCase(),
      url: m[3],
      status: m[4] === "pending" ? 0 : parseInt(m[4]),
    });
  }

  // Filter: skip static assets and non-http URLs, keep API calls
  const SKIP = /\.(js|css|jpg|jpeg|png|gif|webp|svg|woff2?|ttf|ico|m3u8|mp4|m4s)(\?|$)|^(blob:|data:)/i;
  let filtered = requests.filter((r) => !SKIP.test(r.url));

  // Apply URL pattern filter
  if (urlPattern) {
    let re: RegExp;
    try {
      re = new RegExp(urlPattern, "i");
    } catch {
      return {
        success: false,
        action: "dev",
        error: `Invalid URL pattern regex: "${urlPattern}"`,
      };
    }
    filtered = filtered.filter((r) => re.test(r.url));
  }

  // Group by URL pattern for API discovery
  const apiPatterns = new Map<string, typeof filtered>();
  for (const req of filtered) {
    let pattern: string;
    try {
      const url = new URL(req.url);
      pattern = url.pathname
        .replace(/\/\d+/g, "/:id")
        .replace(/\/[a-f0-9-]{20,}/g, "/:uuid");
    } catch {
      pattern = req.url;
    }

    if (!apiPatterns.has(pattern)) apiPatterns.set(pattern, []);
    apiPatterns.get(pattern)!.push(req);
  }

  const lines: string[] = [
    `Network Log (${filtered.length} API requests out of ${requests.length} total)`,
    "",
  ];

  // Detailed request list
  lines.push("## Requests\n");
  for (const req of filtered.slice(0, 50)) {
    const status = req.status === 0 ? "[pending]" : `[${req.status}]`;
    const method = req.method.padEnd(6);
    const url = req.url.length > 120 ? req.url.substring(0, 120) + "..." : req.url;
    lines.push(`  ${method} ${status} ${url}`);
  }
  if (filtered.length > 50) {
    lines.push(`  ... and ${filtered.length - 50} more`);
  }

  // API pattern summary
  if (apiPatterns.size > 0) {
    lines.push("\n## API Patterns\n");
    for (const [pattern, reqs] of apiPatterns) {
      const methods = [...new Set(reqs.map((r) => r.method))];
      lines.push(`  ${methods.join("/")} ${pattern} (${reqs.length} calls)`);
    }
  }

  if (filtered.length === 0) {
    lines.push("\nNo API requests found. Try:");
    lines.push("  1. Navigate to a page first: browser browse <url>");
    lines.push("  2. Interact with the page (scroll, search, click)");
    lines.push("  3. Re-run: browser dev network-log");
  }

  return {
    success: true,
    action: "dev",
    data: {
      content: lines.join("\n"),
      requests: filtered.slice(0, 50).map((r) => ({
        url: r.url,
        method: r.method,
        status: r.status,
        type: "fetch",
        size: 0,
        duration: 0,
      })),
    },
  };
}
