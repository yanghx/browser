import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureDaemon, sendCommand } from "./daemon-client.js";

export async function registerTools(server: McpServer) {
  // Ensure daemon is running before registering tools
  await ensureDaemon();

  const description = `Browser automation via Chrome DevTools. Operates the user's real Chrome browser with existing login sessions.

All commands go through a persistent daemon — Chrome connection is reused across calls (no permission dialogs after first connect).

PREFERRED: Use the "command" parameter with CLI-style commands:
  browser({ command: "browse https://example.com" })
  browser({ command: "site twitter/search AI agent" })
  browser({ command: "site twitter/thread 2032478407146311850" })
  browser({ command: "click Login" })
  browser({ command: "eval document.title" })

Commands reference:
  browse <url>                    Navigate and extract page content as Markdown
  click <target>                  Click element (UID, CSS selector, or text)
  fill <target> <value>           Fill an input field
  type <target> <value>           Type text into focused element
  press <key>                     Press a key (Enter, Tab, Escape, etc.)
  snapshot                        Get page accessibility tree with element UIDs
  screenshot                      Take a screenshot
  search <query>                  Find elements matching text on page
  extract <selector>              Extract structured data (json/markdown/csv)
  eval <script>                   Execute JavaScript in browser context
  network                         View network requests (xhr, fetch, etc.)
  state                           Page state summary (links, forms, errors)
  tab list|new|select|close       Tab management
  back / forward / wait           Navigation

Site recipes (eval-in-browser, uses Chrome login via fetch API):
  site list                       List all available site recipes
  site twitter/search <query>     Search tweets
  site twitter/thread <tweet_id>  Get tweet thread
  site twitter/user <screen_name> Get user profile
  site github/repo <owner/repo>   Get repo info
  site <platform/action> [args]   Run any @params recipe from ~/.md-browser/

Shopee (use when user mentions Shopee, shopping on Shopee, Shopee products):
  site shopee/search <keyword>    Search Shopee products by keyword (--limit N)
  site shopee/detail <url>        Get product details, price, specs, reviews
  site shopee/cart                View Shopee shopping cart contents
  site shopee/add-to-cart <url>   Add product to cart (--model N --quantity N)
  site shopee/checkout            Preview checkout (--confirm yes to place order)

Gmail (use when user mentions Gmail, email, inbox, send email):

Recording:
  trace start|stop|status         Record real user interactions in Chrome
  dev codegen <file>              Generate TS/Python from recorded trace
  dev replay <file>               Replay a saved trace

Dev tools:
  dev cli <url>                   Reverse-engineer site API → generate @params recipe
  dev inspect <selector>          Inspect elements by CSS selector
  dev network-log                 Capture XHR/fetch for API discovery`;

  server.tool(
    "browser",
    description,
    {
      command: z.string().describe(
        "CLI-style command string. e.g. 'site twitter/search AI agent', 'browse https://example.com', 'eval document.title'"
      ),
      sessionId: z.string().optional().describe(
        "Session ID for connection isolation (default: 'default'). Same sessionId reuses the same Chrome tab context."
      ),
    },
    async (params) => {
      const command = params.command as string;
      const sessionId = (params.sessionId as string) || "default";

      try {
        const response = await sendCommand(command, sessionId);
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      } catch (err: any) {
        // Retry once — daemon may have crashed
        try {
          await ensureDaemon();
          const response = await sendCommand(command, sessionId);
          return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
        } catch (retryErr: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Daemon error: ${retryErr.message}` }) }] };
        }
      }
    }
  );
}
