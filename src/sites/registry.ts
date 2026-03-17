/**
 * Site recipe registry — scans directories for @params .js files.
 *
 * Directories (in priority order):
 *   ~/.md-browser/sites/       Local / private recipes (highest priority)
 */

import type { SiteMeta, ArgDef } from "./types.js";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative } from "path";
import { homedir } from "os";

const BB_DIR = join(homedir(), ".md-browser");
const LOCAL_SITES_DIR = join(BB_DIR, "sites");
const COMMUNITY_SITES_DIR = join(BB_DIR, "sites2");

// ─── @params parser ────────────────────────────────────────────

const META_RE = /\/\*\s*@params\s*\n([\s\S]*?)\*\//;

function parseSiteMeta(
  filePath: string,
  source: "local" | "community",
  sitesDir: string,
): SiteMeta | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  // Default name inferred from file path: twitter/thread.js → "twitter/thread"
  const defaultName = relative(sitesDir, filePath)
    .replace(/\.js$/, "")
    .replace(/\\/g, "/");

  const metaMatch = content.match(META_RE);
  if (metaMatch) {
    try {
      const json = JSON.parse(metaMatch[1]);
      return {
        name: json.name || defaultName,
        description: json.description || "",
        domain: json.domain || "",
        args: json.args || {},
        capabilities: json.capabilities,
        readOnly: json.readOnly,
        example: json.example,
        runtime: json.runtime === "node" ? "node" : undefined,
        auth: /^(cookie|bearer\+csrf(\+webpack)?)$/.test(json.auth || "") ? json.auth : undefined,
        filePath,
        source,
      };
    } catch {
      // JSON parse failed — fall through
    }
  }

  // Fallback: // @tag format (legacy compat)
  const meta: SiteMeta = {
    name: defaultName,
    description: "",
    domain: "",
    args: {},
    filePath,
    source,
  };

  const tagRe = /\/\/\s*@(\w+)[ \t]+(.*)/g;
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    const [, key, value] = m;
    switch (key) {
      case "name": meta.name = value.trim(); break;
      case "description": meta.description = value.trim(); break;
      case "domain": meta.domain = value.trim(); break;
      case "args":
        for (const arg of value.trim().split(/[,\s]+/).filter(Boolean)) {
          meta.args[arg] = { required: true };
        }
        break;
      case "example": meta.example = value.trim(); break;
    }
  }

  return meta;
}

// ─── Directory scanner ───────────────────────────────────────

function scanSites(dir: string, source: "local" | "community"): SiteMeta[] {
  if (!existsSync(dir)) return [];
  const sites: SiteMeta[] = [];

  function walk(currentDir: string): void {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        const meta = parseSiteMeta(fullPath, source, dir);
        if (meta) sites.push(meta);
      }
    }
  }

  walk(dir);
  return sites;
}

// ─── Cache ───────────────────────────────────────────────────

let cachedSites: SiteMeta[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 10_000; // 10 seconds

// ─── Public API ──────────────────────────────────────────────

/** Get all recipes (local overrides community). Cached for 10s. */
export function getAllSites(): SiteMeta[] {
  if (cachedSites && Date.now() - cacheTime < CACHE_TTL) return cachedSites;

  const community = scanSites(COMMUNITY_SITES_DIR, "community");
  const local = scanSites(LOCAL_SITES_DIR, "local");

  const byName = new Map<string, SiteMeta>();
  for (const s of community) byName.set(s.name, s);
  for (const s of local) byName.set(s.name, s); // local wins

  cachedSites = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  cacheTime = Date.now();
  return cachedSites;
}

/** Find a recipe by exact name (e.g. "twitter/thread") */
export function findSite(name: string): SiteMeta | undefined {
  return getAllSites().find((s) => s.name === name);
}

/** List all sites grouped by platform */
export function listSites(): Array<{
  name: string;
  description: string;
  actions: string[];
}> {
  const sites = getAllSites();
  const groups = new Map<string, SiteMeta[]>();

  for (const s of sites) {
    const platform = s.name.split("/")[0];
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform)!.push(s);
  }

  const result: Array<{ name: string; description: string; actions: string[] }> = [];
  for (const [platform, items] of groups) {
    result.push({
      name: platform,
      description: items.map((s) => s.description).filter(Boolean)[0] || "",
      actions: items.map((s) => s.name.split("/").slice(1).join("/")),
    });
  }

  return result;
}

/**
 * Read recipe .js file and return the function body (with @params stripped).
 * This is what gets eval'd inside the browser tab.
 */
export function readRecipeBody(site: SiteMeta): string {
  const content = readFileSync(site.filePath, "utf-8");
  return content.replace(/\/\*\s*@params[\s\S]*?\*\//, "").trim();
}

