/**
 * Guide text for creating site recipes.
 * Plain text (no ANSI colors) so it can be embedded in generated reports.
 */

export const GUIDE_TEXT = `How to turn any website into a browser site recipe
====================================================

1. REVERSE ENGINEER the API

   browser browse <url>             Navigate to the target page
   browser cli <url>                Auto-capture API calls and generate recipe
   browser dev network-log          Capture XHR/fetch requests for API discovery
   browser network                  View all network requests
   browser dev inspect              Inspect page elements and structure
   browser snapshot                 Get page accessibility tree (see what's rendered)
   browser screenshot               Take a screenshot of the current page
   browser eval <js>                Execute JavaScript in the browser tab
   browser dev test-selector <sel>  Test a CSS selector (--extract for data)
   browser dev test-script <js>     Test a JavaScript snippet

   Workflow:
     a. browser browse <url>        → open the page
     b. browser dev network-log     → see what API calls the page makes
     c. browser eval "fetch('/api/endpoint',{credentials:'include'}).then(r=>r.json())"
        → test if direct fetch works

2. DETERMINE the auth tier

   Tier 1 — Cookie (simplest: Reddit, GitHub, Zhihu, Bilibili)
     Just use credentials:'include', browser sends cookies automatically.

   Tier 2 — Bearer + CSRF (Twitter/X, some SPAs)
     Needs Authorization header + CSRF token extracted from cookies.

   Tier 3 — Client-side signing (Xiaohongshu, some apps)
     Needs request signing via bundled JS modules (webpack/vite).

3. WRITE the recipe (one .js file per operation)

   Save to: ~/.md-browser/sites/<platform>/<action>.js

   --- Browser mode (runs inside Chrome tab) ---

   /* @params
   {
     "name": "platform/action",
     "description": "What it does",
     "domain": "www.example.com",
     "args": { "query": {"required": true, "description": "Search query"} },
     "readOnly": true,
     "example": "browser site platform/action test"
   }
   */
   async function(args) {
     const resp = await fetch('/api/search?q=' + encodeURIComponent(args.query),
       {credentials: 'include'});
     if (!resp.ok) return {error: 'HTTP ' + resp.status};
     return await resp.json();
   }

   --- Node mode (runs without Chrome, reads auth.json) ---

   /* @params
   {
     "name": "platform/action.node",
     "domain": "www.example.com",
     "runtime": "node",
     "auth": "bearer+csrf",
     "args": { "query": {"required": true} }
   }
   */
   async function(args, ctx) {
     // ctx.headers  — pre-built headers (Cookie + Bearer + CSRF + UA)
     // ctx.baseUrl  — "https://www.example.com"
     // ctx.cookies / ctx.cookieMap / ctx.bearer / ctx.csrf
     const resp = await fetch(ctx.baseUrl + '/api/search?q=' +
       encodeURIComponent(args.query), {headers: ctx.headers});
     if (!resp.ok) return {error: 'HTTP ' + resp.status};
     return await resp.json();
   }

4. SHAPE the response (match what the page actually displays)

   API responses often contain far more data than what the UI shows.
   Use the DOM as the source of truth for which fields matter:

   browser snapshot                  See what's rendered on the page
   browser eval "document.querySelector('.post').innerText"
   browser dev test-selector ".post" --extract    Extract data from selector

   Then write a parser that extracts ONLY the fields visible in the UI:

   const d = await resp.json();
   // DON'T return d directly — it has too much internal noise
   // DO map to clean objects matching what the page displays:
   const results = d.items.map(item => ({
     id: item.id,
     title: item.title,           // displayed as heading
     author: item.user.name,      // displayed as byline
     content: item.body,          // displayed as main text
     date: item.created_at,       // displayed as timestamp
     url: item.permalink,         // link target
   }));
   return { count: results.length, results };

   Rule: if a field is not visible in the DOM, don't include it.
   Rule: flatten nested objects — return simple key:value pairs.
   Rule: use the same field names the UI labels suggest.

5. SET UP AUTH (for node-mode recipes)

   browser auth save <domain>       Extract cookies from Chrome → auth.json
   browser auth show <domain>       Show saved auth info

6. TEST

   browser site platform/action "test query"
   browser site platform/action.node "test query"    (node mode)
   browser site list                                  List all available recipes


Available commands reference:
   browser browse <url>             Navigate and extract page content
   browser click <target>           Click an element
   browser fill <target> <value>    Fill an input field
   browser type <text>              Type text
   browser press <key>              Press a key (Enter, Tab, etc.)
   browser scroll <direction>       Scroll the page (up/down)
   browser snapshot                 Get page accessibility tree
   browser screenshot [--output p]  Take a screenshot
   browser search <query>           Find elements matching text
   browser extract <sel> [--format] Extract data (json/markdown/csv)
   browser eval <script>            Execute JavaScript in browser
   browser network [--type xhr]     View network requests
   browser state                    Page state summary
   browser tab list|new|select      Tab management
   browser site <name> [args]       Run a site recipe
   browser auth save|show <domain>  Manage auth credentials
   browser dev inspect              Inspect page elements
   browser dev network-log          Capture XHR/fetch for API discovery
   browser dev test-selector <sel>  Test CSS selector
   browser dev test-script <js>     Test JavaScript snippet
   browser dev trace start|stop     Record user interactions
   browser guide                    Show this guide

Files:
   ~/.md-browser/sites/<platform>/<action>.js        Browser recipe
   ~/.md-browser/sites/<platform>/<action>.node.js   Node recipe
   ~/.md-browser/sites/<platform>/auth.json          Auth data
   ~/.md-browser/sites/<platform>/_analysis_*.md     API analysis report`;
