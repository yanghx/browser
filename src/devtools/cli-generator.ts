/**
 * Site recipe generator — reverse-engineer a website's API calls
 * and generate an @params recipe .js file.
 *
 * Strategy: inject fetch/XHR interceptors into the page, reload, collect
 * all captured requests with full headers and response bodies.
 */

import type { ActionContext, BrowserActionResponse } from "../actions/types.js";
import { ensureDomainTab } from "../page-manager.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const SITES_DIR = join(homedir(), ".md-browser", "sites");

// ─── Types ───────────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  responseBody?: string;
  responseSize?: number;
}

interface AuthAnalysis {
  tier: 1 | 2 | 3;
  tierLabel: string;
  cookies: string[];
  bearerToken?: string;
  csrfHeader?: string;
  csrfCookie?: string;
  customHeaders: Record<string, string>;
  needsWebpack: boolean;
}

// ─── Interceptor script (runs inside browser) ────────────────

/**
 * Injected into the page via evaluate_script BEFORE reload.
 * Monkey-patches fetch() and XMLHttpRequest to capture all API calls.
 * Results stored in window.__bb_captured and retrieved later.
 */
const INSTALL_INTERCEPTOR = `
(() => {
  window.__bb_captured = [];
  const MAX = 30;
  const NOISE = /analytics|tracking|collect|pixel|telemetry|beacon|sentry|hotjar|gtag|gtm|doubleclick|googlesyndication|\.m3u8|\.mp4|\.m4s|\.mp3|\.jpg|\.png|\.gif|\.webp|\.svg|\.woff|\.css|\.js$|video\.twimg|pbs\.twimg|abs\.twimg|proxsee\.pscp|user_flow\.json|badge_count|subscription.*Product|hashflags|settings\.json|DataSaverMode|fleetline|PinnedTimelines|DmSettings|DirectCall|AltTextPrompt/i;

  // ── Patch fetch ──
  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = (typeof input === 'string') ? input : (input?.url || '');
    const method = (init?.method || 'GET').toUpperCase();
    const headers = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        for (const [k, v] of init.headers) headers[k] = v;
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k] = v;
      } else {
        Object.assign(headers, init.headers);
      }
    }
    const resp = await origFetch.apply(this, arguments);
    if (!NOISE.test(url) && window.__bb_captured.length < MAX) {
      try {
        const clone = resp.clone();
        const body = await clone.text().catch(() => '');
        window.__bb_captured.push({
          url, method, status: resp.status, requestHeaders: headers,
          responseBody: body.substring(0, 3000),
          responseSize: body.length,
        });
      } catch {}
    }
    return resp;
  };

  // ── Patch XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__bb_method = method;
    this.__bb_url = url;
    this.__bb_headers = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(key, val) {
    if (this.__bb_headers) this.__bb_headers[key] = val;
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    xhr.addEventListener('loadend', function() {
      const url = xhr.__bb_url || '';
      if (!NOISE.test(url) && window.__bb_captured && window.__bb_captured.length < MAX) {
        try {
          const text = xhr.responseText || '';
          window.__bb_captured.push({
            url, method: (xhr.__bb_method || 'GET').toUpperCase(),
            status: xhr.status,
            requestHeaders: xhr.__bb_headers || {},
            responseBody: text.substring(0, 3000),
            responseSize: text.length,
          });
        } catch {}
      }
    });
    return origSend.apply(this, arguments);
  };

  return 'interceptor installed';
})()`;

const COLLECT_RESULTS = `
(() => {
  return window.__bb_captured || [];
})()`;

// ─── Main function ───────────────────────────────────────────

export async function generateSiteCLI(
  uri: string,
  ctx: ActionContext,
  outputDir?: string,
): Promise<BrowserActionResponse> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(uri);
  } catch {
    return { success: false, action: "dev", error: `Invalid URL: "${uri}"` };
  }
  const hostname = parsedUrl.hostname.replace(/^www\./, "");
  const platform = hostname.split(".")[0];

  // 1. Ensure domain tab exists (skip wait — we navigate immediately after)
  await ensureDomainTab(ctx.chrome, ctx.state, hostname, { url: uri, skipWait: true });
  // Navigate with initScript to install interceptors before page JS runs
  await ctx.chrome.callTool("navigate_page", {
    url: uri,
    initScript: INSTALL_INTERCEPTOR,
  });
  await new Promise((r) => setTimeout(r, 6000));

  // 2. Take snapshot (required by Chrome MCP before evaluate_script)
  await ctx.chrome.callTool("take_snapshot", {});

  // 3. Collect captured requests
  const collectResult = await ctx.run({ action: "eval", script: COLLECT_RESULTS });
  const rawCaptured: any[] = Array.isArray(collectResult.data?.result)
    ? collectResult.data.result
    : [];

  // Convert to typed array
  const captured: CapturedRequest[] = rawCaptured.map((r: any) => ({
    url: r.url || "",
    method: r.method || "GET",
    status: r.status || 0,
    requestHeaders: r.requestHeaders || {},
    responseBody: r.responseBody || undefined,
    responseSize: r.responseSize || 0,
  }));

  // 5. If interceptor missed (e.g. page re-initialized), fall back to performance API
  if (captured.length === 0) {
    const perfResult = await ctx.run({
      action: "eval",
      script: `(() => {
        return performance.getEntriesByType('resource')
          .filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
          .slice(0, 30)
          .map(e => ({ url: e.name, method: 'GET', status: 200, requestHeaders: {} }));
      })()`,
    });
    const perfEntries: any[] = Array.isArray(perfResult.data?.result) ? perfResult.data.result : [];
    for (const e of perfEntries) {
      captured.push({ url: e.url, method: "GET", status: 200, requestHeaders: {} });
    }
  }

  if (captured.length === 0) {
    return {
      success: true, action: "dev",
      data: {
        title: `API analysis for ${hostname}`,
        content: [
          `No XHR/fetch requests captured on ${uri}.`,
          "",
          "The page may use SSR or WebSocket. Try:",
          "  1. Interact with the page (scroll, search, click)",
          "  2. Run: browser dev network-log",
          "  3. Then re-run: browser cli " + uri,
        ].join("\n"),
      },
    };
  }

  // 6. Get page cookies
  const cookieResult = await ctx.run({ action: "eval", script: "document.cookie" });
  const cookies = (cookieResult.data?.result as string) || "";

  // 7. Analyze auth patterns
  const auth = analyzeAuth(captured, cookies);

  // 8. Analyze response structure by re-calling the best API in browser
  const bestApi = [...captured]
    .filter((r) => r.status === 200 && r.responseBody)
    .sort((a, b) => (b.responseSize || 0) - (a.responseSize || 0))[0];
  let responseSchema: ResponseSchema | null = null;
  if (bestApi) {
    responseSchema = await analyzeResponseInBrowser(bestApi, ctx);
  }

  // 9. Build report + recipe
  const bestApiForName = [...captured]
    .filter((r) => r.status === 200 && r.responseBody)
    .sort((a, b) => (b.responseSize || 0) - (a.responseSize || 0))[0];
  const actionName = inferActionName(bestApiForName);
  const report = buildReport(uri, platform, captured, auth, cookies);
  const starter = generateRecipe(uri, platform, captured, auth, responseSchema);

  // 10. Save
  const dir = outputDir || join(SITES_DIR, platform);
  await mkdir(dir, { recursive: true });
  const reportFile = join(dir, `_analysis_${actionName}.md`);
  const starterFile = join(dir, `${actionName}.js`);
  await writeFile(reportFile, report, "utf-8");
  await writeFile(starterFile, starter, "utf-8");

  return {
    success: true, action: "dev",
    data: {
      title: `API analysis for ${hostname}`,
      content: [
        `Analysis: ${reportFile}`,
        `Starter recipe: ${starterFile}`,
        `Captured: ${captured.length} API requests`,
        "",
        report,
      ].join("\n"),
      result: { reportFile, starterFile, auth, requestCount: captured.length },
    },
  };
}

// ─── Auth Analysis ───────────────────────────────────────────

const INFRA_HEADERS = /^x-(cache|powered|forwarded|amz-|request-id|envoy|b3|trace|frame|content-type-options|xss-protection|dns-prefetch)/;

function analyzeAuth(requests: CapturedRequest[], cookies: string): AuthAnalysis {
  const result: AuthAnalysis = {
    tier: 1, tierLabel: "Cookie (simple fetch)",
    cookies: [], customHeaders: {}, needsWebpack: false,
  };

  for (const req of requests) {
    const headers = req.requestHeaders;

    const get = (name: string) => {
      const ln = name.toLowerCase();
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === ln) return v;
      }
      return "";
    };

    // Bearer token
    const authHeader = get("Authorization");
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      result.bearerToken = authHeader.substring(7);
      result.tier = 2;
    }

    // Scan all headers
    for (const [key, val] of Object.entries(headers)) {
      const lk = key.toLowerCase();
      if (lk.includes("csrf") || lk.includes("xsrf")) {
        result.csrfHeader = key;
        result.tier = Math.max(result.tier, 2) as 1 | 2 | 3;
      }
      if (lk === "x-twitter-auth-type" || lk === "x-client-transaction-id") {
        result.customHeaders[key] = val;
        if (lk === "x-client-transaction-id") {
          result.needsWebpack = true;
          result.tier = 3;
        }
      }
      // Collect auth-related x- headers (skip infra noise, skip csrf — handled separately)
      if (lk.startsWith("x-") && !lk.startsWith("x-requested") && !INFRA_HEADERS.test(lk)
        && !lk.includes("csrf") && !lk.includes("xsrf") && val && val.length > 5) {
        result.customHeaders[key] = val;
      }
    }
  }

  // Match CSRF cookie from page cookies
  if (result.csrfHeader && cookies) {
    // Find the CSRF header value from any request
    let csrfVal = "";
    for (const req of requests) {
      csrfVal = req.requestHeaders[result.csrfHeader] || req.requestHeaders[result.csrfHeader.toLowerCase()] || "";
      if (csrfVal) break;
    }
    if (csrfVal) {
      const pairs = cookies.split(";").map((c) => c.trim());
      for (const pair of pairs) {
        const [name, ...rest] = pair.split("=");
        if (rest.join("=") === csrfVal) {
          result.csrfCookie = name;
          break;
        }
      }
    }
  }

  // Auto-detect auth cookies from cookie jar
  if (cookies) {
    const names = cookies.split(";").map((c) => c.trim().split("=")[0]);
    for (const name of names) {
      if (/ct0|csrf|xsrf|session|token|auth|sid|jsessionid/i.test(name)) {
        if (!result.cookies.includes(name)) result.cookies.push(name);
      }
    }
  }

  // Set tier label
  if (result.tier === 3) result.tierLabel = "Webpack module injection";
  else if (result.tier === 2) result.tierLabel = "Bearer + CSRF";

  return result;
}

// ─── Report Builder ──────────────────────────────────────────

function buildReport(
  uri: string, platform: string, requests: CapturedRequest[],
  auth: AuthAnalysis, cookies: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${platform} — API Analysis`);
  lines.push(``);
  lines.push(`**URL:** ${uri}`);
  lines.push(`**Captured:** ${requests.length} API requests`);
  lines.push(``);

  // Auth
  lines.push(`## Auth Pattern: Tier ${auth.tier} — ${auth.tierLabel}`);
  lines.push(``);
  if (auth.bearerToken) lines.push(`- Bearer: \`${auth.bearerToken.substring(0, 40)}...\``);
  if (auth.csrfHeader) lines.push(`- CSRF header: \`${auth.csrfHeader}\``);
  if (auth.csrfCookie) lines.push(`- CSRF from cookie: \`${auth.csrfCookie}\``);
  if (auth.cookies.length > 0) lines.push(`- Auth cookies: ${auth.cookies.map((c) => `\`${c}\``).join(", ")}`);
  if (Object.keys(auth.customHeaders).length > 0) {
    lines.push(`- Custom headers:`);
    for (const [k, v] of Object.entries(auth.customHeaders))
      lines.push(`  - \`${k}: ${v.substring(0, 60)}${v.length > 60 ? "..." : ""}\``);
  }
  lines.push(``);

  // Cookies
  if (cookies) {
    lines.push(`## Cookies`);
    lines.push(``);
    for (const pair of cookies.split(";").map((c) => c.trim()).filter(Boolean).slice(0, 20)) {
      const [name, ...rest] = pair.split("=");
      const val = rest.join("=");
      lines.push(`- \`${name}\` = \`${val.substring(0, 50)}${val.length > 50 ? "..." : ""}\``);
    }
    lines.push(``);
  }

  // Endpoints
  lines.push(`## API Endpoints`);
  lines.push(``);
  for (const req of requests) {
    const display = req.url.length > 120 ? req.url.substring(0, 120) + "..." : req.url;
    lines.push(`### ${req.method} [${req.status}] ${display}`);

    // Show auth-relevant request headers
    const interesting = Object.entries(req.requestHeaders).filter(([k]) =>
      /authorization|csrf|token|x-twitter|x-client|content-type/i.test(k)
    );
    if (interesting.length > 0) {
      lines.push(`Request headers:`);
      for (const [k, v] of interesting)
        lines.push(`  ${k}: ${v.substring(0, 80)}${v.length > 80 ? "..." : ""}`);
    }

    if (req.responseBody) {
      lines.push(`\nResponse (${req.responseBody.length} chars):`);
      lines.push("```");
      lines.push(req.responseBody.substring(0, 1500));
      lines.push("```");
    }
    lines.push(``);
  }

  // Hints
  lines.push(`## Recipe template`);
  lines.push(``);
  if (auth.tier === 1) {
    lines.push("```javascript");
    lines.push("const resp = await fetch('/api/endpoint', {credentials: 'include'});");
    lines.push("if (!resp.ok) return {error: 'HTTP ' + resp.status};");
    lines.push("return await resp.json();");
    lines.push("```");
  } else {
    lines.push("```javascript");
    if (auth.csrfCookie) {
      lines.push(`const csrf = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('${auth.csrfCookie}='))?.split('=')[1];`);
    }
    if (auth.bearerToken) lines.push(`const bearer = '${auth.bearerToken.substring(0, 30)}...'; // see full in generated recipe`);
    lines.push("const _h = {");
    if (auth.bearerToken) lines.push("  'Authorization': 'Bearer ' + bearer,");
    if (auth.csrfHeader) lines.push(`  '${auth.csrfHeader}': csrf,`);
    for (const [k, v] of Object.entries(auth.customHeaders))
      lines.push(`  '${escapeJS(k)}': '${escapeJS(v)}',`);
    lines.push("};");
    lines.push("const resp = await fetch(url, {headers: _h, credentials: 'include'});");
    lines.push("```");
  }

  return lines.join("\n");
}

// ─── Recipe Generator ────────────────────────────────────────

function generateRecipe(
  uri: string, platform: string, requests: CapturedRequest[], auth: AuthAnalysis,
  schema: ResponseSchema | null,
): string {
  const hostname = new URL(uri).hostname.replace(/^www\./, "");

  // Pick the most valuable API: largest response body = likely the main data endpoint
  const apiReq = [...requests]
    .filter((r) => r.status === 200 && r.responseBody)
    .sort((a, b) => (b.responseSize || 0) - (a.responseSize || 0))[0]
    || requests[0];
  const apiPath = apiReq ? safePath(apiReq.url) : "/api/example";

  // Infer args from the API request
  const inferredArgs = inferArgs(apiReq);
  // Infer action name from GraphQL operation or URL path
  const actionName = inferActionName(apiReq);

  const lines: string[] = [];

  lines.push(`/* @params`);
  lines.push(`{`);
  lines.push(`  "name": ${JSON.stringify(platform + "/" + actionName)},`);
  lines.push(`  "description": ${JSON.stringify(inferDescription(apiReq))},`);
  lines.push(`  "domain": ${JSON.stringify(hostname)},`);
  if (inferredArgs.length > 0) {
    lines.push(`  "args": {`);
    lines.push(inferredArgs.map(
      (a) => `    ${JSON.stringify(a.name)}: {"required": ${a.required}, "description": ${JSON.stringify(a.description)}}`
    ).join(",\n"));
    lines.push(`  },`);
  } else {
    lines.push(`  "args": {},`);
  }
  lines.push(`  "capabilities": ["network"],`);
  lines.push(`  "readOnly": true,`);
  const exampleArgs = inferredArgs.filter((a) => a.required).map((a) => `<${a.name}>`).join(" ");
  lines.push(`  "example": "browser site ${platform}/${actionName}${exampleArgs ? " " + exampleArgs : ""}"`);
  lines.push(`}`);
  lines.push(`*/`);
  lines.push(``);
  lines.push(`async function(args) {`);
  // Only add required arg validation
  for (const a of inferredArgs.filter((a) => a.required)) {
    lines.push(`  if (!args.${a.name}) return {error: 'Missing argument: ${a.name}'};`);
  }

  if (auth.tier === 1) {
    lines.push(``);
    lines.push(`  const resp = await fetch('${escapeJS(apiPath)}', {credentials: 'include'});`);
    lines.push(`  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};`);
    lines.push(`  const d = await resp.json();`);
    const parserLines = generateParser(schema);
    if (parserLines.length > 0) {
      lines.push(``);
      for (const l of parserLines) lines.push(`  ${l}`);
    } else {
      lines.push(`  return d;`);
    }
  } else {
    const csrfVar = auth.csrfCookie
      ? auth.csrfCookie.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^(\d)/, "_$1")
      : "csrf";
    lines.push(``);
    if (auth.csrfCookie) {
      lines.push(`  const ${csrfVar} = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('${escapeJS(auth.csrfCookie)}='))?.split('=')[1];`);
      lines.push(`  if (!${csrfVar}) return {error: 'No ${escapeJS(auth.csrfCookie)} cookie', hint: 'Not logged into ${escapeJS(hostname)}'};`);
    }
    if (auth.bearerToken) {
      // Bearer token may contain special chars — use single-quote escaping
      lines.push(`  const bearer = '${escapeJS(auth.bearerToken)}';`);
    }
    lines.push(`  const _h = {`);
    if (auth.bearerToken) lines.push(`    'Authorization': 'Bearer ' + bearer,`);
    if (auth.csrfHeader && auth.csrfCookie) lines.push(`    '${escapeJS(auth.csrfHeader)}': ${csrfVar},`);
    for (const [k, v] of Object.entries(auth.customHeaders)) {
      if (k.toLowerCase() === "x-client-transaction-id") continue;
      lines.push(`    '${escapeJS(k)}': '${escapeJS(v)}',`);
    }
    lines.push(`  };`);
    lines.push(``);

    if (auth.needsWebpack) {
      lines.push(`  // Tier 3: webpack module injection for transaction ID`);
      lines.push(`  // let __webpack_require__;`);
      lines.push(`  // window.webpackChunk_XXX.push([['__bb_'+Date.now()],{},(r)=>{__webpack_require__=r}]);`);
      lines.push(`  // _h['X-Client-Transaction-Id'] = await __webpack_require__(83914).jJ('${hostname}',path,'GET');`);
      lines.push(``);
    }

    if (apiReq && apiReq.url.includes("graphql")) {
      const gql = parseGraphQLUrl(apiReq.url);
      const basePath = escapeJS(gql.basePath);

      // Variables — wire up args, keep defaults for the rest
      if (gql.variables) {
        lines.push(`  const variables = JSON.stringify({`);
        for (const [k, v] of Object.entries(gql.variables)) {
          const argMatch = inferredArgs.find((a) => variableMatchesArg(k, a.name));
          if (argMatch) {
            // Wire to args with default fallback
            const defaultVal = JSON.stringify(v);
            if (typeof v === "number") {
              lines.push(`    ${JSON.stringify(k)}: parseInt(args.${argMatch.name}) || ${defaultVal},`);
            } else {
              lines.push(`    ${JSON.stringify(k)}: args.${argMatch.name} || ${defaultVal},`);
            }
          } else {
            lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
          }
        }
        lines.push(`  });`);
      } else {
        lines.push(`  const variables = JSON.stringify({count: 20});`);
      }

      // Features — extract originals
      if (gql.features && Object.keys(gql.features).length > 0) {
        lines.push(`  const features = JSON.stringify({`);
        for (const [k, v] of Object.entries(gql.features)) {
          lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
        }
        lines.push(`  });`);
      } else {
        lines.push(`  const features = JSON.stringify({});`);
      }

      // fieldToggles if present
      if (gql.fieldToggles && Object.keys(gql.fieldToggles).length > 0) {
        lines.push(`  const fieldToggles = JSON.stringify(${JSON.stringify(gql.fieldToggles)});`);
        lines.push(`  const url = '${basePath}?variables=' + encodeURIComponent(variables) + '&features=' + encodeURIComponent(features) + '&fieldToggles=' + encodeURIComponent(fieldToggles);`);
      } else {
        lines.push(`  const url = '${basePath}?variables=' + encodeURIComponent(variables) + '&features=' + encodeURIComponent(features);`);
      }
    } else {
      const sep = apiPath.includes("?") ? "&" : "?";
      lines.push(`  const url = '${escapeJS(apiPath)}${sep}q=' + encodeURIComponent(args.query);`);
    }

    lines.push(`  const resp = await fetch(url, {headers: _h, credentials: 'include'});`);
    lines.push(`  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'queryId may have changed'};`);
    lines.push(`  const d = await resp.json();`);

    // Auto-generate response parser from captured response body
    const parserLines = generateParser(schema);
    if (parserLines.length > 0) {
      lines.push(``);
      for (const l of parserLines) lines.push(`  ${l}`);
    } else {
      lines.push(`  return d;`);
    }
  }

  lines.push(`}`);
  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function escapeJS(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\0/g, "\\0")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ─── Response Schema Analysis (runs in browser) ─────────────

interface ResponseSchema {
  arrayPath: string;        // JS path to the data array, e.g. "d.data.home.home_timeline_urt.instructions"
  itemFields: string[];     // field extraction lines for each item
  isTimeline: boolean;      // Twitter-style instructions[].entries[] pattern
}

/**
 * Re-call the API in the browser and analyze the full response structure.
 * Returns a schema describing where the data array is and what fields items have.
 */
async function analyzeResponseInBrowser(
  req: CapturedRequest, ctx: ActionContext,
): Promise<ResponseSchema | null> {
  // Build a script that re-fetches the same API and analyzes the response
  const headersJson = JSON.stringify(req.requestHeaders);
  const script = `
(async () => {
  try {
    const resp = await fetch(${JSON.stringify(req.url)}, {
      method: ${JSON.stringify(req.method)},
      headers: ${headersJson},
      credentials: 'include',
    });
    if (!resp.ok) return null;
    const d = await resp.json();

    // Walk the JSON tree to find the main data array
    function findArray(obj, path, depth) {
      if (depth > 8) return null;
      if (Array.isArray(obj) && obj.length >= 2) {
        const objs = obj.filter(i => i && typeof i === 'object' && !Array.isArray(i));
        if (objs.length >= 2) return { path, items: objs };
      }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        let best = null;
        for (const [k, v] of Object.entries(obj)) {
          const r = findArray(v, path + '.' + k, depth + 1);
          if (r && (!best || r.items.length > best.items.length)) best = r;
        }
        return best;
      }
      return null;
    }

    // First, check for timeline pattern (instructions[].entries[]) — common in Twitter/X
    // This takes priority over generic array detection
    function findInstructions(obj, path, depth) {
      if (depth > 6) return null;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if (obj.instructions && Array.isArray(obj.instructions)) {
          const instr = obj.instructions;
          for (const inst of instr) {
            if (inst.entries && Array.isArray(inst.entries) && inst.entries.length > 0) {
              return { path: path + '.instructions', entries: inst.entries };
            }
          }
        }
        for (const [k, v] of Object.entries(obj)) {
          const r = findInstructions(v, path + '.' + k, depth + 1);
          if (r) return r;
        }
      }
      return null;
    }

    const timeline = findInstructions(d, 'd', 0);
    if (timeline) {
      // Found timeline pattern — check for tweet_results
      for (const entry of timeline.entries) {
        const r = entry.content?.itemContent?.tweet_results?.result;
        if (r) {
          const tw = r.tweet || r;
          return {
            arrayPath: timeline.path,
            isTimeline: true,
            hasTweetResults: true,
          };
        }
      }
    }

    const arr = findArray(d, 'd', 0);
    if (!arr) return null;

    const isTimeline = arr.path.includes('instructions');

    // For timelines, find tweet fields from the first entry's tweet_results
    if (isTimeline) {
      const instructions = arr.items[0]?.entries ? [arr.items[0]] :
        (function getInstr(o, p) {
          if (Array.isArray(o)) return o;
          if (o && typeof o === 'object') {
            for (const v of Object.values(o)) { const r = getInstr(v); if (r) return r; }
          }
          return null;
        })(d.data);

      if (instructions) {
        for (const inst of instructions) {
          for (const entry of (inst.entries || [])) {
            const r = entry.content?.itemContent?.tweet_results?.result;
            if (r) {
              const tw = r.tweet || r;
              const l = tw.legacy || {};
              const u = tw.core?.user_results?.result;
              // Return the schema with confirmed fields
              return {
                arrayPath: arr.path,
                isTimeline: true,
                hasTweetResults: true,
                sampleFields: {
                  hasRestId: !!tw.rest_id,
                  hasFullText: !!l.full_text,
                  hasScreenName: !!u?.legacy?.screen_name,
                  hasFavoriteCount: l.favorite_count !== undefined,
                  hasRetweetCount: l.retweet_count !== undefined,
                  hasCreatedAt: !!l.created_at,
                  hasNoteTweet: !!tw.note_tweet,
                },
              };
            }
          }
        }
      }
    }

    // Generic: extract field names from first item
    const sample = arr.items[0];
    function getFields(obj, prefix, depth) {
      if (!obj || typeof obj !== 'object' || depth > 3) return [];
      const fields = [];
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? prefix + '.' + k : k;
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          if (!/typename|cursor|clientEvent|controller|injection|entryType/i.test(k)) {
            fields.push({ name: k, path: p, type: typeof v, len: String(v).length });
          }
        } else if (typeof v === 'object' && !Array.isArray(v)) {
          fields.push(...getFields(v, p, depth + 1));
        }
      }
      return fields;
    }

    return {
      arrayPath: arr.path,
      isTimeline: false,
      itemCount: arr.items.length,
      fields: getFields(sample, '', 0).slice(0, 20),
    };
  } catch (e) {
    return null;
  }
})()`;

  try {
    const result = await ctx.run({ action: "eval", script });
    const schema = result.data?.result;
    if (!schema || typeof schema !== "object") return null;
    return schema as ResponseSchema;
  } catch {
    return null;
  }
}

/** Generate response parsing code from schema */
function generateParser(schema: ResponseSchema | null): string[] {
  if (!schema) return [];
  const lines: string[] = [];

  if ((schema as any).isTimeline && (schema as any).hasTweetResults) {
    // Twitter timeline pattern
    const instrPath = schema.arrayPath.replace(/^d\./, "");
    lines.push(`// Parse timeline`);
    lines.push(`const instructions = d.${instrPath} || [];`);
    lines.push(`let results = [], seen = new Set();`);
    lines.push(`for (const inst of instructions) {`);
    lines.push(`  for (const entry of (inst.entries || [])) {`);
    lines.push(`    const r = entry.content?.itemContent?.tweet_results?.result;`);
    lines.push(`    if (!r) continue;`);
    lines.push(`    const tw = r.tweet || r;`);
    lines.push(`    const l = tw.legacy || {};`);
    lines.push(`    if (!tw.rest_id || seen.has(tw.rest_id)) continue;`);
    lines.push(`    seen.add(tw.rest_id);`);
    lines.push(`    const u = tw.core?.user_results?.result;`);
    lines.push(`    const nt = tw.note_tweet?.note_tweet_results?.result?.text;`);
    lines.push(`    results.push({`);
    lines.push(`      id: tw.rest_id,`);
    lines.push(`      author: u?.legacy?.screen_name,`);
    lines.push(`      text: nt || l.full_text || '',`);
    lines.push(`      url: 'https://x.com/' + (u?.legacy?.screen_name || '_') + '/status/' + tw.rest_id,`);
    lines.push(`      likes: l.favorite_count, retweets: l.retweet_count,`);
    lines.push(`      created_at: l.created_at,`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(`return {count: results.length, results};`);
    return lines;
  }

  // Generic array pattern
  const fields: any[] = (schema as any).fields || [];
  if (fields.length === 0) return [];

  const arrayAccess = schema.arrayPath.replace(/^d\./, "");
  lines.push(`// Parse response`);
  lines.push(`const items = d.${arrayAccess} || [];`);
  lines.push(`const results = items.map(item => ({`);

  // Pick useful fields
  const useful = fields.filter((f: any) =>
    /^(id|rest_id|name|title|text|full_text|description|url|href|screen_name|username|author|score|likes|count|created|published|date|status|slug)$/i.test(f.name)
    || (f.type === "string" && f.len > 5 && f.len < 300)
  ).slice(0, 12);

  for (const f of useful) {
    lines.push(`  ${f.name}: item?.${f.path},`);
  }
  lines.push(`}));`);
  lines.push(`return {count: results.length, results};`);
  return lines;
}

/** Infer a human-readable description from the API request */
function inferDescription(req: CapturedRequest | undefined): string {
  if (!req) return "TODO";
  try {
    const u = new URL(req.url);
    // GraphQL: extract operation name → readable
    const gqlMatch = u.pathname.match(/\/graphql\/[^/]+\/([^/?]+)/);
    if (gqlMatch) {
      // CamelCase → "Home Timeline" style
      return gqlMatch[1].replace(/([a-z])([A-Z])/g, "$1 $2");
    }
    // REST: last path segment
    const seg = u.pathname.split("/").filter(Boolean).pop() || "";
    return seg.replace(/\.json$/, "").replace(/[_-]/g, " ");
  } catch {
    return "TODO";
  }
}

/** Infer action name from API request (GraphQL operation name or URL path) */
function inferActionName(req: CapturedRequest | undefined): string {
  if (!req) return "example";
  try {
    const u = new URL(req.url);
    // GraphQL: /i/api/graphql/abc123/OperationName → "home"
    const gqlMatch = u.pathname.match(/\/graphql\/[^/]+\/([^/?]+)/);
    if (gqlMatch) {
      return gqlMatch[1]
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()
        // Remove common suffixes to shorten
        .replace(/_(timeline|query|mutation|list|details|results|feed)$/i, "")
        // Remove "use_" prefix (React hook naming leaked into operation)
        .replace(/^use_/, "");
    }
    // REST: /i/api/1.1/statuses/home_timeline.json → "home"
    const lastSeg = u.pathname.split("/").filter(Boolean).pop() || "example";
    return lastSeg.replace(/\.json$/, "").replace(/_timeline$/, "").toLowerCase();
  } catch {
    return "example";
  }
}

interface InferredArg {
  name: string;
  required: boolean;
  description: string;
}

/** Infer @params args from the API request's variables/query params */
function inferArgs(req: CapturedRequest | undefined): InferredArg[] {
  if (!req) return [{ name: "query", required: true, description: "Search query" }];

  try {
    const u = new URL(req.url);

    // GraphQL — check variables for user-facing params
    if (req.url.includes("graphql")) {
      const raw = u.searchParams.get("variables");
      if (raw) {
        const vars = JSON.parse(raw);
        const args: InferredArg[] = [];

        // Known user-facing variable patterns
        if ("rawQuery" in vars || "query" in vars) {
          args.push({ name: "query", required: true, description: "Search query" });
        }
        if ("screen_name" in vars) {
          args.push({ name: "screen_name", required: true, description: "Username" });
        }
        if ("userId" in vars) {
          args.push({ name: "user_id", required: true, description: "User ID" });
        }
        if ("focalTweetId" in vars) {
          args.push({ name: "tweet_id", required: true, description: "Tweet ID" });
        }

        return args;
      }
    }

    // REST — check query params for search-like patterns
    for (const [key] of u.searchParams) {
      if (/^(q|query|search|keyword|term)$/i.test(key)) {
        return [
          { name: "query", required: true, description: "Search query" },
        ];
      }
    }
  } catch {
    // ignore
  }

  // No user-facing args detected (e.g. timeline, feed)
  return [];
}

/** Check if a GraphQL variable name corresponds to an inferred arg */
function variableMatchesArg(varName: string, argName: string): boolean {
  // Direct match: count↔count, rawQuery↔query
  if (varName === argName) return true;
  // rawQuery / query
  if (varName === "rawQuery" && argName === "query") return true;
  // screen_name
  if (varName === "screen_name" && argName === "screen_name") return true;
  // userId / user_id
  if (varName === "userId" && argName === "user_id") return true;
  // focalTweetId / tweet_id
  if (varName === "focalTweetId" && argName === "tweet_id") return true;
  return false;
}

/** Parse a GraphQL URL into base path + decoded variables/features/fieldToggles */
function parseGraphQLUrl(url: string): {
  basePath: string;
  variables?: Record<string, any>;
  features?: Record<string, any>;
  fieldToggles?: Record<string, any>;
} {
  try {
    const u = new URL(url);
    const basePath = u.pathname;
    const parse = (key: string) => {
      const raw = u.searchParams.get(key);
      if (!raw) return undefined;
      try { return JSON.parse(raw); } catch { return undefined; }
    };
    return {
      basePath,
      variables: parse("variables"),
      features: parse("features"),
      fieldToggles: parse("fieldToggles"),
    };
  } catch {
    return { basePath: url.split("?")[0] };
  }
}
