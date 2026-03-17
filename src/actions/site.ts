/**
 * Site action handler — supports two execution modes:
 *
 *   runtime: "browser" (default) — eval-in-browser via Chrome DevTools
 *   runtime: "node"             — run directly in Node.js (no Chrome needed)
 *
 * Flow:
 *   1. Find recipe by name (e.g. "twitter/thread")
 *   2. Parse CLI args → argMap
 *   3. Check runtime:
 *      - "node"    → execute directly via AsyncFunction
 *      - "browser" → find/create domain tab, eval via Chrome DevTools
 *   4. Parse result, handle {error} responses
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
import { loadAuth, buildFetchHeaders, parseCookieMap } from "../auth/cookie-store.js";

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
            "  Recipes: ~/.md-browser/sites/<platform>/<action>.js\n" +
            "  Generate: browser cli <url>",
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

  // ── Read recipe body ──
  const jsBody = readRecipeBody(recipe);
  const argsJson = JSON.stringify(argMap);

  // ── Determine runtime: "node" runs JS in Node.js instead of Chrome ──
  const useNode = recipe.runtime === "node";

  let parsed: any;

  if (useNode) {
    // ── Node.js execution — read auth from auth.json, no Chrome needed ──
    const auth = loadAuth(recipe.filePath);
    if (recipe.domain && !auth) {
      return {
        success: false,
        action: "site",
        error: `No auth.json for ${recipe.domain}. Run: auth save ${recipe.domain}`,
      };
    }

    const cookies = auth?.cookies || "";
    const nodeCtx = {
      cookies,
      cookieMap: parseCookieMap(cookies),
      domain: recipe.domain,
      baseUrl: recipe.domain ? `https://${recipe.domain}` : "",
      bearer: auth?.bearer || "",
      csrf: auth?.csrf ? parseCookieMap(cookies)[auth.csrf.cookie] || "" : "",
      headers: auth ? buildFetchHeaders(auth) : {},
      auth,
    };

    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction("args", "ctx", `return await (${jsBody})(args, ctx)`);
      const result = await fn(argMap, nodeCtx);
      parsed = result;
    } catch (err: any) {
      return {
        success: false,
        action: "site",
        error: `Recipe eval failed (node): ${err.message || String(err)}`,
      };
    }
  } else {
    // ── Browser execution via Chrome DevTools ──
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

    try {
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
      parsed = extractJson(text) ?? text;
    } catch (err: any) {
      return {
        success: false,
        action: "site",
        error: `Recipe eval failed: ${err.message || String(err)}`,
      };
    }
  }

  // ── Handle recipe-level {error} responses ──
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
};

