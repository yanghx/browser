/**
 * Site action handler — eval-in-browser execution.
 *
 * Flow:
 *   1. Find recipe by name (e.g. "twitter/thread")
 *   2. Parse CLI args → argMap
 *   3. Find/create a tab matching the recipe's domain
 *   4. Read .js file, strip @params, construct: (jsBody)(argsJson)
 *   5. Eval in the browser tab via Chrome DevTools
 *   6. Parse result, handle {error} responses
 */

import type { ActionHandler } from "./types.js";
import {
  getAllSites,
  findSite,
  listSites,
  readRecipeBody,
} from "../sites/registry.js";
import { ensureDomainTab } from "../page-manager.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const siteAction: ActionHandler = async (request, ctx) => {
  const { site, siteAction: actionName, args: siteArgs } = request;

  // ── "site list" ──
  if (site === "list" || (!site && !actionName)) {
    const sites = listSites();
    if (sites.length === 0) {
      return {
        success: true,
        action: "site",
        data: {
          content:
            "No site recipes found.\n" +
            "  Install community recipes: clone bb-sites into ~/.md-browser/bb-sites/\n" +
            "  Private recipes: ~/.md-browser/sites/<platform>/<action>.js",
        },
      };
    }
    const lines = sites.map(
      (s) =>
        `- **${s.name}**: ${s.description}\n  Actions: ${s.actions.join(", ")}`,
    );
    return {
      success: true,
      action: "site",
      data: { content: "Available sites:\n\n" + lines.join("\n\n") },
    };
  }

  if (!site) {
    return { success: false, action: "site", error: "site name is required" };
  }

  // ── Resolve recipe name ──
  const recipeName = actionName ? `${site}/${actionName}` : site;
  const recipe = findSite(recipeName);

  if (!recipe) {
    const all = getAllSites();
    // Fuzzy match
    const fuzzy = all.filter((s) => s.name.includes(site));
    const hint = fuzzy.length > 0
      ? `Did you mean: ${fuzzy.slice(0, 5).map((s) => s.name).join(", ")}`
      : "Try: site list";
    return {
      success: false,
      action: "site",
      error: `Recipe "${recipeName}" not found. ${hint}`,
    };
  }

  // ── Validate required args ──
  const argMap: Record<string, string> = { ...siteArgs };
  for (const [argName, argDef] of Object.entries(recipe.args)) {
    if (argDef.required && !argMap[argName]) {
      const usage = Object.entries(recipe.args)
        .map(([n, d]) => (d.required ? `<${n}>` : `[${n}]`))
        .join(" ");
      return {
        success: false,
        action: "site",
        error: `Missing required argument: ${argName}.\n  Usage: site ${recipe.name} ${usage}${recipe.example ? `\n  Example: ${recipe.example}` : ""}`,
      };
    }
  }

  // ── Ensure one tab per domain ──
  if (recipe.domain) {
    try {
      await ensureDomainTab(ctx.chrome, ctx.state, recipe.domain);
    } catch (err: any) {
      return {
        success: false,
        action: "site",
        error: `Failed to open tab for ${recipe.domain}: ${err.message}`,
      };
    }
  }

  // ── Build and eval script ──
  const jsBody = readRecipeBody(recipe);
  const argsJson = JSON.stringify(argMap);

  try {
    // Ensure snapshot exists (required by Chrome MCP before evaluate_script)
    if (!ctx.state.getCachedSnapshot()) {
      await ctx.chrome.callTool("take_snapshot", {});
    }

    const wrapper = `async () => {
  try {
    const __result = await (${jsBody})(${argsJson});
    return __result;
  } catch (e) {
    return { error: e.message, stack: e.stack?.substring(0, 500) };
  }
}`;

    const result = await ctx.chrome.callTool("evaluate_script", {
      function: wrapper,
    });

    const text = extractText(result);
    let parsed: any = extractJson(text) ?? text;

    // Handle recipe-level {error} responses
    if (parsed && typeof parsed === "object" && "error" in parsed && !("count" in parsed)) {
      const errObj = parsed as { error: string; hint?: string };
      const isAuthError =
        /401|403|unauthorized|forbidden|not.?logged|login.?required|sign.?in|auth|ct0/i.test(
          `${errObj.error} ${errObj.hint || ""}`,
        );
      const hint = isAuthError && recipe.domain
        ? `Please log in to https://${recipe.domain} in your browser first, then retry.`
        : errObj.hint;
      return {
        success: false,
        action: "site",
        error: `${errObj.error}${hint ? `\n  Hint: ${hint}` : ""}`,
      };
    }

    return {
      success: true,
      action: "site",
      data: {
        title: recipe.name,
        content: typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2),
        result: parsed,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      action: "site",
      error: `Recipe eval failed: ${err.message || String(err)}`,
    };
  }
};

