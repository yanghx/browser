/**
 * Daemon HTTP client — sends commands to the running daemon.
 */

import type { BrowserActionResponse } from "./actions/types.js";

const DEFAULT_PORT = parseInt(process.env.BROWSER_DAEMON_PORT || "19825", 10);
const BASE = `http://127.0.0.1:${DEFAULT_PORT}`;

export interface DaemonStatus {
  running: boolean;
  pid: number;
  uptime: number;
  sessions: string[];
  port: number;
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.running;
  } catch {
    return false;
  }
}

export async function getDaemonStatus(): Promise<DaemonStatus | null> {
  try {
    const resp = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function sendCommand(
  command: string,
  sessionId = "default",
): Promise<BrowserActionResponse> {
  const resp = await fetch(`${BASE}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, sessionId }),
    signal: AbortSignal.timeout(65_000),
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Daemon returned invalid response: ${text.substring(0, 200)}`);
  }
}

export async function shutdownDaemon(): Promise<void> {
  try {
    await fetch(`${BASE}/shutdown`, { method: "POST", signal: AbortSignal.timeout(5000) });
  } catch {
    // Already down
  }
}

export async function ensureDaemon(): Promise<void> {
  if (await isDaemonRunning()) return;

  const { spawn } = await import("child_process");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");

  const thisDir = dirname(fileURLToPath(import.meta.url));
  const daemonPath = join(thisDir, "daemon.js");

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Poll until ready (max 8s)
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (await isDaemonRunning()) return;
  }

  throw new Error("Daemon failed to start within 8s");
}
