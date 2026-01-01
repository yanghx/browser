#!/usr/bin/env node
import * as readline from "readline";
import { writeFile } from "fs/promises";
import { ChromeClient } from "./chrome-client.js";
import { StateManager } from "./state.js";
import { makeContext } from "./context.js";
import { parseCommand } from "./command-parser.js";
import type {
  BrowserActionRequest,
  BrowserActionResponse,
} from "./actions/types.js";
import {
  serializeTrace,
  deserializeTrace,
  type Trace,
} from "./devtools/recorder.js";
import { generateTypeScript, generatePython } from "./devtools/codegen.js";

// ANSI colors
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const noColor = process.argv.includes("--no-color");
const useJson = process.argv.includes("--json");

function col(fn: (s: string) => string, s: string): string {
  return noColor ? s : fn(s);
}

// ─── CLI Engine ────────────────────────────────────────────────

class BrowserCLI {
  private chrome: ChromeClient;
  private state: StateManager;

  constructor() {
    this.chrome = new ChromeClient();
    this.state = new StateManager();
  }

  async connect() {
    const command = process.env.CHROME_MCP_COMMAND || "npx";
    const browserUrl = process.env.BROWSER_URL;
    const args = (
      process.env.CHROME_MCP_ARGS ||
      (browserUrl
        ? `chrome-devtools-mcp@latest --browserUrl ${browserUrl}`
        : "chrome-devtools-mcp@latest --autoConnect")
    ).split(" ");
    await this.chrome.connect({ command, args });
  }

  async disconnect() {
    await this.chrome.disconnect();
  }

  async execute(request: BrowserActionRequest): Promise<BrowserActionResponse> {
    const ctx = makeContext(this.chrome, this.state);
    return ctx.run(request);
  }
}

// ─── Output Formatting ────────────────────────────────────────

function formatResponse(response: BrowserActionResponse): string {
  if (useJson) return JSON.stringify(response, null, 2);

  const lines: string[] = [];

  if (!response.success) {
    lines.push(col(c.red, `✗ Error: ${response.error}`));
    return lines.join("\n");
  }

  const d = response.data;
  if (!d) {
    lines.push(col(c.green, "✓ Done"));
    return lines.join("\n");
  }

  // Title + URL header
  if (d.title || d.url) {
    lines.push(col(c.green, `✓ ${d.title || ""}`) + (d.url ? col(c.dim, ` | ${d.url}`) : ""));
  }

  // Content
  if (d.content) {
    lines.push(d.content);
  }

  // Elements
  if (d.elements && d.elements.length > 0) {
    lines.push("");
    lines.push(col(c.cyan, `[Interactive Elements]`));
    for (const el of d.elements.slice(0, 20)) {
      lines.push(`  ${col(c.yellow, el.uid)} ${col(c.dim, `[${el.role}]`)} ${el.name}`);
    }
    if (d.elements.length > 20) {
      lines.push(col(c.dim, `  ... and ${d.elements.length - 20} more`));
    }
  }

  // Tabs
  if (d.tabs && d.tabs.length > 0) {
    for (const tab of d.tabs) {
      lines.push(`  ${col(c.yellow, String(tab.id))} ${tab.title} ${col(c.dim, tab.url)}`);
    }
  }

  // Network requests
  if (d.requests && d.requests.length > 0) {
    lines.push("");
    for (const req of d.requests) {
      const status = req.status >= 400 ? col(c.red, String(req.status)) : col(c.green, String(req.status));
      lines.push(
        `  ${col(c.cyan, req.method.padEnd(6))} ${status} ${req.url.substring(0, 80)} ${col(c.dim, req.type)}`
      );
    }
  }

  // Result (eval) — skip if content already shown to avoid double output
  if (d.result !== undefined && !d.content) {
    lines.push(
      typeof d.result === "object"
        ? JSON.stringify(d.result, null, 2)
        : String(d.result)
    );
  }

  return lines.join("\n");
}

// parseCommand is imported from ./command-parser.js
// parseArgs/parseFlags kept for REPL recording save/codegen commands

function parseArgs(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
      } else {
        current += ch;
      }
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
      // Support --key=value syntax
      const eqIdx = part.indexOf("=");
      if (eqIdx > 2) {
        flags[part.substring(2, eqIdx)] = part.substring(eqIdx + 1);
        continue;
      }
      const key = part.substring(2);
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (part.startsWith("-") && part.length === 2) {
      // Support short flags like -i, -h
      flags[part.substring(1)] = true;
    }
  }
  return flags;
}

// ─── REPL Mode ────────────────────────────────────────────────

async function startRepl(cli: BrowserCLI) {
  let lastTrace: Trace | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: col(c.cyan, "browser> "),
  });

  console.log(col(c.bold, "Browser - Interactive Mode"));
  console.log(col(c.dim, 'Type a command or "help". Use "trace start" to record browser interactions.\n'));
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === "exit" || input === "quit") {
      await cli.disconnect();
      process.exit(0);
    }

    if (input === "help") {
      printHelp();
      rl.prompt();
      return;
    }

    // Trace save shortcut
    if (input.startsWith("trace save ") || input.startsWith("dev save ")) {
      if (!lastTrace || lastTrace.events.length === 0) {
        console.log(col(c.red, "No trace to save. Run: trace start → interact → trace stop"));
      } else {
        const file = parseArgs(input).pop() || "trace.json";
        try {
          await writeFile(file, serializeTrace(lastTrace), "utf-8");
          console.log(col(c.green, `Saved ${lastTrace.events.length} events to ${file}`));
        } catch (err: any) {
          console.log(col(c.red, `Error: ${err.message}`));
        }
      }
      rl.prompt();
      return;
    }

    // Quick codegen from last trace
    if (input.startsWith("dev codegen") && !input.includes("/") && lastTrace && lastTrace.events.length > 0) {
      const flags = parseFlags(input.split(" "));
      const code = (flags.lang || "ts") === "python"
        ? generatePython(lastTrace)
        : generateTypeScript(lastTrace);
      if (flags.output) {
        try {
          await writeFile(flags.output, code, "utf-8");
          console.log(col(c.green, `Code saved to ${flags.output}`));
        } catch (err: any) {
          console.log(col(c.red, `Error: ${err.message}`));
        }
      } else {
        console.log(code);
      }
      rl.prompt();
      return;
    }

    const request = parseCommand(input);
    if (!request) {
      console.log(col(c.red, "Could not parse command. Type 'help' for usage."));
      rl.prompt();
      return;
    }

    try {
      const response = await cli.execute(request);
      console.log(formatResponse(response));
      // Save trace result for save/codegen
      if (response.data?.result?.events && Array.isArray(response.data.result.events)) {
        lastTrace = response.data.result as Trace;
      }
    } catch (err: any) {
      console.log(col(c.red, `Error: ${err.message}`));
    }

    console.log("");
    rl.prompt();
  });

  rl.on("close", async () => {
    await cli.disconnect();
    process.exit(0);
  });
}

// ─── Help ─────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${col(c.bold, "Usage:")} browser [options] <action> [args...]

${col(c.bold, "Options:")}
  -i, --interactive    Interactive REPL mode
  --json               Output raw JSON
  --no-color           Disable color output
  --direct             Bypass daemon, connect directly to Chrome MCP
  -h, --help           Show this help

${col(c.bold, "Daemon:")}
  daemon / start         Start background daemon (persistent Chrome connection)
  stop                   Stop the daemon
  status                 Show daemon status

${col(c.bold, "Actions:")}
  browse <url>                    Navigate and extract page content
  click <target>                  Click an element
  fill <target> <value>           Fill an input field
  type <target> <value>           Type text
  press <key>                     Press a key
  snapshot                        Get page accessibility tree
  screenshot [--output path]      Take a screenshot
  search <query>                  Find elements matching text
  extract <selector> [--format]   Extract data (json/markdown/csv)
  eval <script>                   Execute JavaScript
  network [--type xhr,fetch]      View network requests
  state                           Page state summary
  tab list|new|select|close       Tab management
  site <site/action> [args...]    Site recipes (uses Chrome login)
  cli <url> [--output dir]        Reverse-engineer site API → generate @params recipe
  trace start|stop|status         Record real user interactions in Chrome
  dev inspect|codegen|replay ...  Development tools

${col(c.bold, "Site recipes (eval-in-browser, uses Chrome login via fetch API):")}
  site list                       List all available recipes
  site twitter/search <query>     Search tweets
  site twitter/thread <tweet_id>  Get tweet thread
  site twitter/user <screen_name> Get user profile
  site twitter/tweets <name>      Get user timeline
  site github/repo <owner/repo>   Get repo info
  site reddit/thread <url>        Get Reddit thread
  site <platform/action> [args]   Run any @params recipe

${col(c.bold, "Shortcuts (platform aliases):")}
  x search <query>                → site twitter/search <query>
  gh repo <owner/repo>            → site github/repo <owner/repo>
  hn top                          → site hackernews/top
  gm inbox                        → site gmail/inbox
  gm search <query>               → site gmail/search <query>
  gm unread                       → site gmail/unread

${col(c.bold, "Gmail:")}
  site gmail/inbox [--limit N]                List inbox
  site gmail/unread [--limit N]               List unread messages
  site gmail/read <id>                        Read a message
  site gmail/thread <threadId>                Read full conversation
  site gmail/search <query> [--limit N]       Search (Gmail query syntax)
  site gmail/send --to X --subject X --body X Send email
  site gmail/reply --id X --body X [--all]    Reply to message
  site gmail/star <id> [--remove true]        Star/unstar
  site gmail/archive <id>                     Archive message
  site gmail/trash <id>                       Move to trash
  site gmail/labels                           List labels
`);
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs.filter((a) => !a.startsWith("-"));
  const allFlags = rawArgs.filter((a) => a.startsWith("-"));
  const useDirect = allFlags.includes("--direct"); // bypass daemon

  if (allFlags.includes("--help") || allFlags.includes("-h") || args[0] === "help") {
    printHelp();
    process.exit(0);
  }

  // ── Daemon lifecycle commands ──
  if (args[0] === "daemon" || args[0] === "start") {
    const { ensureDaemon, getDaemonStatus } = await import("./daemon-client.js");
    await ensureDaemon();
    const st = await getDaemonStatus();
    console.log(col(c.green, `Daemon running (pid ${st?.pid}, ${st?.sessions.length || 0} sessions, port ${st?.port})`));
    return;
  }
  if (args[0] === "stop") {
    const { isDaemonRunning, shutdownDaemon } = await import("./daemon-client.js");
    if (await isDaemonRunning()) {
      await shutdownDaemon();
      console.log(col(c.green, "Daemon stopped."));
    } else {
      console.log(col(c.dim, "Daemon not running."));
    }
    return;
  }
  if (args[0] === "status") {
    const { getDaemonStatus } = await import("./daemon-client.js");
    const st = await getDaemonStatus();
    if (st) {
      console.log(`Daemon: ${col(c.green, "running")}`);
      console.log(`  PID: ${st.pid}`);
      console.log(`  Uptime: ${st.uptime}s`);
      console.log(`  Port: ${st.port}`);
      console.log(`  Sessions: ${st.sessions.length > 0 ? st.sessions.join(", ") : "(none)"}`);
    } else {
      console.log(`Daemon: ${col(c.dim, "not running")}`);
      console.log(col(c.dim, "  Start with: browser daemon"));
    }
    return;
  }

  // ── Try daemon mode first (unless --direct) ──
  if (!useDirect) {
    const { isDaemonRunning, sendCommand: daemonSend } = await import("./daemon-client.js");
    if (await isDaemonRunning()) {
      // Interactive REPL via daemon
      if (allFlags.includes("-i") || allFlags.includes("--interactive") || args.length === 0) {
        await startDaemonRepl();
        return;
      }

      // Single command via daemon
      const cleanArgs = process.argv.slice(2)
        .filter((a) => a !== "--json" && a !== "--no-color" && a !== "--direct");
      const input = cleanArgs.join(" ");
      if (!input) { printHelp(); return; }

      try {
        const response = await daemonSend(input);
        console.log(formatResponse(response));
        process.exit(response.success ? 0 : 1);
      } catch (err: any) {
        console.error(col(c.red, `Daemon error: ${err.message}`));
        process.exit(1);
      }
      return;
    }
  }

  // ── Direct mode (no daemon) ──
  const cli = new BrowserCLI();
  console.log(col(c.dim, "Connecting to Chrome DevTools MCP..."));
  try {
    await cli.connect();
  } catch (err: any) {
    console.error(col(c.red, `Failed to connect: ${err.message}`));
    console.error(col(c.dim, "Make sure Chrome is running. Or start daemon: browser daemon"));
    process.exit(1);
  }
  console.log(col(c.green, "Connected."));

  if (allFlags.includes("-i") || allFlags.includes("--interactive") || args.length === 0) {
    await startRepl(cli);
    return;
  }

  // Single command (direct)
  const cleanArgs = process.argv.slice(2)
    .filter((a) => a !== "--json" && a !== "--no-color" && a !== "--interactive" && a !== "-i" && a !== "--direct");

  const input = cleanArgs.join(" ");
  let request = parseCommand(input);

  if (request && cleanArgs.length > 1) {
    const rest = cleanArgs.slice(1).join(" ");
    switch (request.action) {
      case "eval": request.script = rest; break;
      case "search": case "click": case "hover": request.target = rest; break;
      case "wait": request.waitFor = rest; break;
    }
  }
  if (!request) {
    console.error(col(c.red, "Could not parse command. Use --help for usage."));
    process.exit(1);
  }

  try {
    const response = await cli.execute(request);
    console.log(formatResponse(response));
    await cli.disconnect();
    process.exit(response.success ? 0 : 1);
  } catch (err: any) {
    console.error(col(c.red, `Error: ${err.message}`));
    await cli.disconnect();
    process.exit(1);
  }
}

// ─── Daemon REPL ──────────────────────────────────────────────

async function startDaemonRepl() {
  const { sendCommand: daemonSend } = await import("./daemon-client.js");
  const rl = (await import("readline")).createInterface({
    input: process.stdin, output: process.stdout,
    prompt: col(c.cyan, "browser> "),
  });

  console.log(col(c.bold, "Browser - Interactive Mode (via daemon)"));
  console.log(col(c.dim, 'Type a command or "help". "exit" to quit.\n'));
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === "exit" || input === "quit") process.exit(0);
    if (input === "help") { printHelp(); rl.prompt(); return; }

    try {
      const response = await daemonSend(input);
      console.log(formatResponse(response));
    } catch (err: any) {
      console.log(col(c.red, `Error: ${err.message}`));
    }
    console.log("");
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
