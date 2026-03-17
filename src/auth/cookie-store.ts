/**
 * Auth store — persists structured auth data alongside recipe files.
 *
 * Storage: <recipe_dir>/auth.json
 * Example: ~/.md-browser/sites/x/auth.json (shared by all x/* recipes)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

// ─── Types ───────────────────────────────────────────────────

export interface AuthData {
  tier: 0 | 1 | 2 | 3;
  domain: string;
  cookies: string;                      // full cookie string (including HttpOnly)
  bearer?: string;                      // Bearer token
  csrf?: { header: string; cookie: string }; // CSRF header name + cookie name
  headers: Record<string, string>;      // all extra auth headers (x-twitter-auth-type etc.)
  userAgent: string;
  updatedAt: string;                    // ISO date
}

export type AuthTier = "none" | "cookie" | "bearer+csrf" | "bearer+csrf+webpack";

// ─── IO ──────────────────────────────────────────────────────

function authPath(recipeFilePath: string): string {
  return join(dirname(recipeFilePath), "auth.json");
}

/** Load auth data from auth.json. Returns null if not found. */
export function loadAuth(recipeFilePath: string): AuthData | null {
  const p = authPath(recipeFilePath);
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Save auth data to auth.json (owner-only permissions). */
export function saveAuth(recipeFilePath: string, auth: AuthData): void {
  const p = authPath(recipeFilePath);
  writeFileSync(p, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ─── Helpers ─────────────────────────────────────────────────

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Parse cookie string into key-value map. */
export function parseCookieMap(cookieStr: string): Record<string, string> {
  return Object.fromEntries(
    cookieStr
      .split(";")
      .map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, v.join("=")] as [string, string];
      })
      .filter(([k]) => k),
  );
}

/** Convert tier number to @params auth string. */
export function tierToAuth(tier: 0 | 1 | 2 | 3): AuthTier {
  if (tier === 0) return "none";
  if (tier === 3) return "bearer+csrf+webpack";
  if (tier === 2) return "bearer+csrf";
  return "cookie";
}

/** Build the complete headers object a node recipe needs for fetch(). */
export function buildFetchHeaders(auth: AuthData): Record<string, string> {
  const h: Record<string, string> = {};

  // Cookie
  if (auth.cookies) h["Cookie"] = auth.cookies;

  // Bearer
  if (auth.bearer) h["Authorization"] = "Bearer " + auth.bearer;

  // CSRF — read value from cookie string
  if (auth.csrf) {
    const map = parseCookieMap(auth.cookies);
    const csrfVal = map[auth.csrf.cookie];
    if (csrfVal) h[auth.csrf.header] = csrfVal;
  }

  // Extra auth headers
  for (const [k, v] of Object.entries(auth.headers)) {
    h[k] = v;
  }

  // UA
  if (auth.userAgent) h["User-Agent"] = auth.userAgent;

  return h;
}
