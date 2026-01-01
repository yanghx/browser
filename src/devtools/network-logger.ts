import type { ActionContext, BrowserActionResponse } from "../actions/types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

/**
 * Capture and format network requests for API discovery.
 * Shows URL patterns, request/response shapes for building agent CLIs.
 */
export async function captureNetworkLog(
  resourceTypes: string[] | undefined,
  urlPattern: string | undefined,
  ctx: ActionContext
): Promise<BrowserActionResponse> {
  const types = resourceTypes || ["xhr", "fetch"];

  // Include preserved requests to capture requests from before this DevTools session attached
  const result = await ctx.chrome.callTool("list_network_requests", {
    resourceTypes: types,
    includePreservedRequests: true,
  });

  const text = extractText(result);
  const parsed = extractJson(text);
  let requests: any[] = Array.isArray(parsed) ? parsed : parsed?.networkRequests || parsed?.requests || [];

  // If still empty, try without resource type filter (some Chrome MCP versions ignore the filter)
  if (requests.length === 0) {
    const fallback = await ctx.chrome.callTool("list_network_requests", {
      includePreservedRequests: true,
    });
    const fbText = extractText(fallback);
    const fbParsed = extractJson(fbText);
    const allReqs: any[] = Array.isArray(fbParsed) ? fbParsed : fbParsed?.networkRequests || fbParsed?.requests || [];
    requests = allReqs.filter((r: any) => types.includes(r.resourceType || r.type || ""));
  }

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
    requests = requests.filter((r: any) => re.test(r.url || ""));
  }

  // Group by URL pattern for API discovery
  const apiPatterns = new Map<string, any[]>();
  for (const req of requests) {
    let pattern: string;
    try {
      const url = new URL(req.url || "", "http://localhost");
      pattern = url.pathname
        .replace(/\/\d+/g, "/:id")
        .replace(/\/[a-f0-9-]{20,}/g, "/:uuid");
    } catch {
      pattern = req.url || "(unknown)";
    }

    if (!apiPatterns.has(pattern)) {
      apiPatterns.set(pattern, []);
    }
    apiPatterns.get(pattern)!.push(req);
  }

  const lines: string[] = [
    `Network Log (${requests.length} requests, types: ${types.join(", ")})`,
    "",
  ];

  // Detailed request list
  lines.push("## Requests\n");
  for (const req of requests.slice(0, 30)) {
    const status =
      req.status >= 400
        ? `[${req.status}]`
        : `[${req.status || "..."}]`;
    const method = (req.method || "GET").padEnd(6);
    const url = req.url?.substring(0, 100) || "";
    const size = req.responseSize || req.size
      ? ` (${formatBytes(req.responseSize || req.size || 0)})`
      : "";
    const duration = req.duration ? ` ${req.duration}ms` : "";

    lines.push(`  ${method} ${status} ${url}${size}${duration}`);
  }

  // API pattern summary
  if (apiPatterns.size > 0) {
    lines.push("\n## API Patterns\n");
    for (const [pattern, reqs] of apiPatterns) {
      const methods = [...new Set(reqs.map((r: any) => r.method || "GET"))];
      lines.push(`  ${methods.join("/")} ${pattern} (${reqs.length} calls)`);
    }
  }

  return {
    success: true,
    action: "dev",
    data: {
      content: lines.join("\n"),
      requests: requests.slice(0, 50).map((r: any) => ({
        url: r.url || "",
        method: r.method || "GET",
        status: r.status || 0,
        type: r.resourceType || r.type || "",
        size: r.responseSize || r.size || 0,
        duration: r.duration || 0,
      })),
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
