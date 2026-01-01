#!/usr/bin/env node
/**
 * Browser Daemon — persistent Chrome MCP connections.
 *
 * Runs as a background HTTP server on localhost:19825.
 * CLI commands connect via HTTP instead of spawning chrome-devtools-mcp each time.
 *
 * Endpoints:
 *   POST /command   Execute a browser command (same format as CLI)
 *   GET  /status    Daemon status (uptime, sessions)
 *   POST /shutdown  Graceful shutdown
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { SessionManager } from "./session-manager.js";
import { makeContext } from "./context.js";
import { parseCommand } from "./command-parser.js";
import type { BrowserActionRequest } from "./actions/types.js";

const PORT = parseInt(process.env.BROWSER_DAEMON_PORT || "19825", 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  process.stderr.write("[Daemon] Invalid BROWSER_DAEMON_PORT\n");
  process.exit(1);
}
const HOST = "127.0.0.1";
const PID_FILE = "/tmp/browser-daemon.pid";
const COMMAND_TIMEOUT = 60_000;
const MAX_BODY = 1_048_576; // 1MB

const sessions = new SessionManager();
const startTime = Date.now();

// ─── HTTP Helpers ────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY) { req.destroy(); reject(new Error("Body too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── Handlers ────────────────────────────────────────────────

async function handleCommand(req: IncomingMessage, res: ServerResponse) {
  // Block browser requests (DNS rebinding protection)
  if (req.headers.origin) {
    return json(res, 403, { success: false, error: "Browser requests not allowed" });
  }

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    return json(res, 400, { success: false, error: err.message || "Invalid JSON" });
  }

  const sessionId = body.sessionId || "default";

  let request: BrowserActionRequest;
  if (body.command) {
    const parsed = parseCommand(body.command);
    if (!parsed) return json(res, 400, { success: false, error: `Cannot parse: "${body.command}"` });
    request = parsed;
  } else if (body.action) {
    request = body as BrowserActionRequest;
  } else {
    return json(res, 400, { success: false, error: 'Provide "command" or "action"' });
  }

  // Execute with timeout (properly cleared)
  const timer = { id: null as ReturnType<typeof setTimeout> | null };
  try {
    const result = await Promise.race([
      (async () => {
        try {
          const { chrome, state } = await sessions.get(sessionId);
          const ctx = makeContext(chrome, state);
          return await ctx.run(request);
        } catch (err: any) {
          // Detect dead session — destroy and let next request reconnect
          if (/EPIPE|not connected|channel closed|destroyed/i.test(err.message)) {
            await sessions.destroy(sessionId);
          }
          throw err;
        }
      })(),
      new Promise<never>((_, reject) => {
        timer.id = setTimeout(() => reject(new Error("Command timeout (60s)")), COMMAND_TIMEOUT);
      }),
    ]);
    json(res, 200, result);
  } catch (err: any) {
    json(res, 200, { success: false, action: request.action, error: err.message });
  } finally {
    if (timer.id) clearTimeout(timer.id);
  }
}

function handleStatus(_req: IncomingMessage, res: ServerResponse) {
  json(res, 200, {
    running: true,
    pid: process.pid,
    uptime: Math.round((Date.now() - startTime) / 1000),
    sessions: sessions.list(),
    port: PORT,
  });
}

async function handleShutdown(_req: IncomingMessage, res: ServerResponse) {
  json(res, 200, { success: true, message: "Shutting down" });
  // Small delay to flush response before cleanup
  setTimeout(() => cleanup(), 100);
}

// ─── Server ──────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  try {
    if (req.method === "POST" && url === "/command") {
      await handleCommand(req, res);
    } else if (req.method === "GET" && url === "/status") {
      handleStatus(req, res);
    } else if (req.method === "POST" && url === "/shutdown") {
      await handleShutdown(req, res);
    } else {
      json(res, 404, { error: "Not found" });
    }
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
});

// ─── Lifecycle ───────────────────────────────────────────────

let shuttingDown = false;
async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { unlinkSync(PID_FILE); } catch {}
  await sessions.destroyAll();
  server.close(() => process.exit(0));
  // Fallback exit if server.close hangs
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Check for stale PID
if (existsSync(PID_FILE)) {
  const oldPid = parseInt(readFileSync(PID_FILE, "utf-8"), 10);
  try {
    process.kill(oldPid, 0); // check alive
    process.stderr.write(`[Daemon] Warning: existing daemon (pid ${oldPid}) may still be running\n`);
  } catch {
    // Dead process, stale PID — ok to overwrite
  }
}

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`[Daemon] Port ${PORT} already in use — another daemon may be running\n`);
  } else {
    process.stderr.write(`[Daemon] Failed to start: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  writeFileSync(PID_FILE, String(process.pid));
  process.stderr.write(`[Daemon] Running on http://${HOST}:${PORT} (pid ${process.pid})\n`);
});
