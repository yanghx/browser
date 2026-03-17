/**
 * Auth action — extract and save browser auth data for node-runtime recipes.
 *
 * Usage:
 *   browser auth save <domain>   — extract auth from Chrome, save to auth.json
 *   browser auth show <domain>   — show saved auth info
 */

import type { ActionHandler } from "./types.js";
import { getAllSites } from "../sites/registry.js";
import { saveAuth, loadAuth, DEFAULT_USER_AGENT, type AuthData } from "../auth/cookie-store.js";
import { ensureDomainTab } from "../page-manager.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const authAction: ActionHandler = async (request, ctx) => {
  const subAction = request.site;       // "save" or "show"
  const domain = request.siteAction;    // e.g. "x.com"

  if (!subAction || subAction === "help") {
    return {
      success: true,
      action: "auth",
      data: {
        content:
          "Usage:\n" +
          "  auth save <domain>  — extract auth from Chrome and save to auth.json\n" +
          "  auth show <domain>  — show saved auth info\n" +
          "\nExample: auth save x.com",
      },
    };
  }

  if (!domain) {
    return { success: false, action: "auth", error: "Domain required. Example: auth save x.com" };
  }

  const recipes = getAllSites().filter((s) => s.domain === domain);
  if (recipes.length === 0) {
    return {
      success: false,
      action: "auth",
      error: `No recipes found with domain "${domain}". Create a recipe first.`,
    };
  }

  const targetRecipe = recipes[0];

  if (subAction === "show") {
    const auth = loadAuth(targetRecipe.filePath);
    if (!auth) {
      return { success: true, action: "auth", data: { content: `No auth.json for ${domain}` } };
    }
    const lines = [
      `Auth for ${domain} (Tier ${auth.tier}):`,
      `  Bearer: ${auth.bearer ? auth.bearer.substring(0, 30) + "..." : "(none)"}`,
      `  CSRF: ${auth.csrf ? `${auth.csrf.header} from cookie ${auth.csrf.cookie}` : "(none)"}`,
      `  Headers: ${Object.keys(auth.headers).join(", ") || "(none)"}`,
      `  Cookies: ${auth.cookies.split(";").map(c => c.trim().split("=")[0]).filter(Boolean).join(", ")}`,
      `  Updated: ${auth.updatedAt}`,
    ];
    return { success: true, action: "auth", data: { content: lines.join("\n") } };
  }

  if (subAction === "save") {
    try {
      await ensureDomainTab(ctx.chrome, ctx.state, domain);
    } catch (err: any) {
      return { success: false, action: "auth", error: `Failed to open ${domain}: ${err.message}` };
    }

    try {
      if (!ctx.state.getCachedSnapshot()) {
        await ctx.chrome.callTool("take_snapshot", {});
      }

      // ── Extract full cookies (including HttpOnly) from network requests ──
      const netResult = await ctx.chrome.callTool("list_network_requests", {});
      const netText = extractText(netResult);

      let reqId: number | null = null;
      let bestReqId: number | null = null; // prefer API requests
      for (const line of netText.split("\n")) {
        if (line.includes(domain)) {
          const m = line.match(/reqid=(\d+)/);
          if (m) {
            reqId = parseInt(m[1]);
            // Prefer API/graphql requests for richer headers
            if (line.includes("/api/") || line.includes("graphql")) {
              bestReqId = reqId;
            }
          }
        }
      }
      const targetReqId = bestReqId ?? reqId;

      let cookies = "";
      let detectedBearer = "";
      let detectedCsrfHeader = "";
      let detectedCsrfValue = "";
      const detectedHeaders: Record<string, string> = {};
      let userAgent = "";
      let hasTransactionId = false;

      if (targetReqId != null) {
        const detail = await ctx.chrome.callTool("get_network_request", { reqid: targetReqId });
        const detailText = extractText(detail);

        // Parse only Request Headers (stop at "### Response Headers")
        let inRequestHeaders = false;
        for (const line of detailText.split("\n")) {
          if (line.includes("Request Headers")) { inRequestHeaders = true; continue; }
          if (line.includes("Response Headers") || line.includes("Response Body")) { inRequestHeaders = false; continue; }
          if (!inRequestHeaders) continue;

          const m = line.match(/^- ([^:]+):(.+)$/);
          if (!m) continue;
          const [, key, val] = m;
          const lk = key.toLowerCase().trim();
          const v = val.trim();

          if (lk === "cookie") cookies = v;
          else if (lk === "user-agent") userAgent = v;
          else if (lk === "authorization" && v.toLowerCase().startsWith("bearer "))
            detectedBearer = v.substring(7);
          else if (lk.includes("csrf") || lk.includes("xsrf")) {
            detectedCsrfHeader = key.trim();
            detectedCsrfValue = v;
          } else if (lk === "x-client-transaction-id") {
            hasTransactionId = true;
          } else if (lk.startsWith("x-") &&
            !/^x-(cache|powered|forwarded|amz|request-id|envoy|b3|trace|frame|content-type)/.test(lk) &&
            v.length > 3)
            detectedHeaders[key.trim()] = v;
        }
      }

      // Fallback: document.cookie (misses HttpOnly)
      if (!cookies) {
        const result = await ctx.chrome.callTool("evaluate_script", {
          function: `async () => document.cookie`,
        });
        const rawText = extractText(result);
        cookies = extractJson(rawText) ?? rawText;
      }

      if (!cookies || typeof cookies !== "string") {
        return { success: false, action: "auth", error: "Failed to extract cookies (empty result)" };
      }

      // Determine tier
      let tier: 1 | 2 | 3 = 1;
      if (detectedBearer || detectedCsrfHeader) tier = 2;
      if (hasTransactionId) tier = 3;

      // Match CSRF cookie name using the value captured in the first pass
      let csrfInfo: { header: string; cookie: string } | undefined;
      if (detectedCsrfHeader && detectedCsrfValue) {
        const cookiePairs = cookies.split(";").map(c => c.trim());
        for (const pair of cookiePairs) {
          const [name, ...rest] = pair.split("=");
          if (rest.join("=") === detectedCsrfValue) {
            csrfInfo = { header: detectedCsrfHeader, cookie: name };
            break;
          }
        }
      }
      if (detectedCsrfHeader && !csrfInfo) {
        // Fallback: guess common cookie names
        const cookieNames = cookies.split(";").map(c => c.trim().split("=")[0]);
        const guesses = ["ct0", "csrf", "_csrf", "xsrf-token", "XSRF-TOKEN"];
        for (const g of guesses) {
          if (cookieNames.includes(g)) {
            csrfInfo = { header: detectedCsrfHeader, cookie: g };
            break;
          }
        }
      }

      const authData: AuthData = {
        tier,
        domain,
        cookies,
        bearer: detectedBearer || undefined,
        csrf: csrfInfo,
        headers: detectedHeaders,
        userAgent: userAgent || DEFAULT_USER_AGENT,
        updatedAt: new Date().toISOString(),
      };

      saveAuth(targetRecipe.filePath, authData);

      const cookieKeys = cookies.split(";").map(c => c.trim().split("=")[0]).filter(Boolean);
      return {
        success: true,
        action: "auth",
        data: {
          content: [
            `Saved auth.json for ${domain} (Tier ${tier})`,
            `  Bearer: ${detectedBearer ? "yes" : "no"}`,
            `  CSRF: ${csrfInfo ? `${csrfInfo.header} from ${csrfInfo.cookie}` : "no"}`,
            `  Headers: ${Object.keys(detectedHeaders).join(", ") || "(none)"}`,
            `  Cookies (${cookieKeys.length}): ${cookieKeys.join(", ")}`,
          ].join("\n"),
        },
      };
    } catch (err: any) {
      return { success: false, action: "auth", error: `Auth extraction failed: ${err.message}` };
    }
  }

  return { success: false, action: "auth", error: `Unknown sub-action: ${subAction}` };
};
