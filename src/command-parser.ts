import type { ActionType, BrowserActionRequest } from "./actions/types.js";
import { findSite, getAllSites } from "./sites/registry.js";

/**
 * Parse a CLI-style command string into a BrowserActionRequest.
 * Used by both the CLI and the MCP server's `command` parameter.
 *
 * Examples:
 *   "browse https://example.com"
 *   "site twitter/search AI agent"
 *   "site twitter/thread 2032478407146311850"
 *   "eval document.title"
 *   "click Login"
 *   "dev cli https://foodpanda.sg"
 */
export function parseCommand(input: string): BrowserActionRequest | null {
  const parts = parseArgs(input);
  if (parts.length === 0) return null;

  const actionStr = parts[0];

  // "cli <url>" → "dev cli <url>"
  if (actionStr === "cli") {
    return {
      action: "dev" as ActionType,
      devAction: "cli" as any,
      url: parts[1],
      output: parseFlags(parts.slice(2)).output,
    };
  }

  // "tab list/new/select/close"
  if (actionStr === "tab" && parts[1]) {
    const actionMap: Record<string, ActionType> = {
      list: "tab_list", new: "tab_new", select: "tab_select", close: "close",
    };
    const mapped = actionMap[parts[1]];
    if (!mapped) return null;
    const req: BrowserActionRequest = { action: mapped };
    if (parts[1] === "new") req.url = parts[2];
    else if (parts[1] === "select" || parts[1] === "close") {
      const p = parts[2] ? parseInt(parts[2]) : undefined;
      req.tabId = p !== undefined && !isNaN(p) ? p : undefined;
    }
    return req;
  }

  // Site platform shortcuts: "x search AI" → "site twitter/search AI"
  // Dynamically checks if a platform exists in the recipe registry.
  const siteAliases: Record<string, string> = {
    x: "twitter", tw: "twitter", gh: "github", hn: "hackernews", gm: "gmail",
  };
  const knownActions = new Set([
    "browse", "back", "forward", "click", "fill", "type", "hover",
    "press", "scroll", "select", "snapshot", "screenshot", "search",
    "state", "wait", "extract", "eval", "network",
    "tab_list", "tab_new", "tab_select", "close",
    "site", "dev", "cli", "help", "tab",
  ]);
  if (!knownActions.has(actionStr)) {
    const platform = siteAliases[actionStr] || actionStr;
    const actionPart = parts[1];
    if (actionPart) {
      const recipeName = `${platform}/${actionPart}`;
      const recipe = findSite(recipeName);
      if (recipe) {
        return parseCommand(`site ${recipeName} ${parts.slice(2).join(" ")}`);
      }
    }
    // Try as "platform/action" without slash (e.g., "twitter/search")
    if (actionStr.includes("/")) {
      return parseCommand("site " + input);
    }
  }

  // "site list"
  const action = actionStr as ActionType;
  if (action === "site" && parts[1] === "list") {
    return { action: "site", site: "list" };
  }

  // "site twitter/search query" or "site twitter/thread 123"
  if (action === "site" && parts[1]) {
    const slashIdx = parts[1].indexOf("/");
    if (slashIdx > 0) {
      const recipeName = parts[1]; // e.g. "twitter/thread"
      const recipe = findSite(recipeName);

      if (recipe) {
        // Separate --flags from positional args
        const argsMap: Record<string, string> = {};
        const positional: string[] = [];
        const remaining = parts.slice(2);
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].startsWith("--")) {
            const flagName = remaining[i].slice(2);
            if (remaining[i + 1] && !remaining[i + 1].startsWith("-")) {
              argsMap[flagName] = remaining[i + 1];
              i++;
            }
          } else {
            positional.push(remaining[i]);
          }
        }

        // Only map positional args to required arg names.
        // All positional words join into the first required arg (e.g. "AI agent" → query).
        // Optional args (count, type) must use --flag syntax.
        const requiredArgNames = Object.entries(recipe.args)
          .filter(([, def]) => def.required)
          .map(([name]) => name);

        if (positional.length > 0 && requiredArgNames.length > 0) {
          // First required arg gets all positional words joined
          argsMap[requiredArgNames[0]] = positional.join(" ");
        } else if (positional.length > 0) {
          // No required args — map to first arg name
          const firstArg = Object.keys(recipe.args)[0];
          if (firstArg) argsMap[firstArg] = positional.join(" ");
        }

        const site = recipeName.substring(0, slashIdx);
        const sa = recipeName.substring(slashIdx + 1);
        return {
          action: "site",
          site,
          siteAction: sa,
          args: Object.keys(argsMap).length > 0 ? argsMap : undefined,
        };
      }
    }

    // Fallback: pass through as-is
    const site = slashIdx > 0 ? parts[1].substring(0, slashIdx) : parts[1];
    const sa = slashIdx > 0 ? parts[1].substring(slashIdx + 1) : undefined;
    const rest = parts.slice(2).filter((a) => !a.startsWith("-"));
    const flags = parseFlags(parts.slice(2));
    const argsMap: Record<string, string> = { ...flags };
    if (rest.length > 0) argsMap.query = rest.join(" ");
    return {
      action: "site",
      site,
      siteAction: sa,
      args: Object.keys(argsMap).length > 0 ? argsMap : undefined,
    };
  }

  // "trace start/stop/status" → dev trace start/stop/status
  if (actionStr === "trace" && parts[1]) {
    return {
      action: "dev" as ActionType,
      devAction: "trace" as any,
      target: parts[1],  // start, stop, status
    };
  }

  // "dev inspect/trace/..."
  if (action === "dev" && parts[1]) {
    return {
      action: "dev",
      devAction: parts[1] as any,
      selector: parts[2],
      url: parts[2],
      target: parts[2],
      ...parseFlags(parts.slice(2)),
    };
  }

  // General actions
  const flags = parseFlags(parts.slice(1));
  const request: BrowserActionRequest = { action, ...flags };

  switch (action) {
    case "browse": case "tab_new":
      request.url = request.url || parts[1]; break;
    case "click": case "hover": case "search":
      request.target = request.target || parts[1]; break;
    case "fill": case "type": case "select":
      request.target = request.target || parts[1];
      request.value = request.value || parts[2]; break;
    case "press":
      request.value = request.value || parts[1]; break;
    case "extract":
      request.selector = request.selector || parts[1]; break;
    case "eval":
      request.script = request.script || parts.slice(1).join(" "); break;
    case "scroll":
      request.value = request.value || parts[1]; break;
    case "wait":
      request.waitFor = request.waitFor || parts[1]; break;
    case "screenshot":
      request.output = request.output || flags.output; break;
    case "close": case "tab_select": {
      const p = parts[1] ? parseInt(parts[1]) : undefined;
      request.tabId = request.tabId || (p !== undefined && !isNaN(p) ? p : undefined);
      break;
    }
    case "network":
      if (flags.type) request.resourceTypes = (flags.type as string).split(",");
      break;
  }

  return request;
}

// ─── Helpers ──────────────────────────────────────────────────

function parseArgs(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function parseFlags(parts: string[]): Record<string, any> {
  const flags: Record<string, any> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 2) {
        flags[part.substring(2, eqIdx)] = part.substring(eqIdx + 1);
        continue;
      }
      const key = part.substring(2);
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else if (part.startsWith("-") && part.length === 2) {
      flags[part.substring(1)] = true;
    }
  }
  return flags;
}
