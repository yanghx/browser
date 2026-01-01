/**
 * Page Manager — one tab per domain.
 *
 * Tracks which Chrome tab is associated with each domain.
 * Reuses existing tabs, only creates new ones when no match found.
 */

import type { ChromeClientInterface, StateManagerInterface } from "./actions/types.js";
import { extractText, extractJson } from "./formatters/json-cleaner.js";

/** domain → pageId cache */
const domainPages = new Map<string, number>();

/** Dedup concurrent requests for the same domain */
const pending = new Map<string, Promise<void>>();

/**
 * Ensure a tab for the given domain is active.
 * Options:
 *   url — use this URL instead of https://{domain} when creating a new tab
 *   skipWait — don't wait 3s after creating (caller will navigate immediately)
 */
export async function ensureDomainTab(
  chrome: ChromeClientInterface,
  state: StateManagerInterface,
  domain: string,
  opts?: { url?: string; skipWait?: boolean },
): Promise<void> {
  // Dedup: if another call for the same domain is in-flight, wait for it
  const inflight = pending.get(domain);
  if (inflight) return inflight;

  const promise = ensureDomainTabImpl(chrome, state, domain, opts);
  pending.set(domain, promise);
  try {
    await promise;
  } finally {
    pending.delete(domain);
  }
}

async function ensureDomainTabImpl(
  chrome: ChromeClientInterface,
  state: StateManagerInterface,
  domain: string,
  opts?: { url?: string; skipWait?: boolean },
): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[PageMgr] ${msg}\n`);

  // 1. Check cache — but verify the tab still exists and matches
  const cachedPageId = domainPages.get(domain);
  if (cachedPageId !== undefined) {
    const tabs = await listTabs(chrome);
    const cached = tabs.find((t) => t.id === cachedPageId);
    if (cached && matchDomain(cached.url, domain)) {
      log(`cache hit: domain=${domain} → pageId=${cachedPageId}`);
      await chrome.callTool("select_page", { pageId: cachedPageId });
      state.invalidateCache();
      return;
    }
    log(`cache stale: domain=${domain}, pageId=${cachedPageId} not found`);
    domainPages.delete(domain);
  }

  // 2. Scan all tabs for a match
  const tabs = await listTabs(chrome);
  if (tabs.length > 0) {
    log(`scan ${tabs.length} tabs for domain=${domain}`);
    for (const tab of tabs) {
      if (matchDomain(tab.url, domain)) {
        log(`reuse existing tab: pageId=${tab.id}`);
        domainPages.set(domain, tab.id);
        await chrome.callTool("select_page", { pageId: tab.id });
        state.invalidateCache();
        return;
      }
    }
  }

  // 3. No matching tab — create one.
  //    new_page returns the full pages list, so we can check AGAIN for
  //    domain matches (list_pages may have failed due to "selected page closed").
  log(`creating new page for domain=${domain}`);
  state.invalidateCache();
  const targetUrl = opts?.url ?? `https://${domain}`;
  const newResult = await chrome.callTool("new_page", { url: targetUrl });

  const newText = extractText(newResult);
  const newParsed = extractJson(newText);

  // new_page returns { pages: [...] } with ALL open pages
  const allPages: any[] = newParsed?.pages || [];
  const newlyCreated = allPages.find((p: any) => p.selected);
  const newPageId: number | undefined = newlyCreated?.id;

  // Check if an OLDER tab already had this domain (list_pages may have missed it)
  const existingMatch = allPages.find(
    (p: any) => p.id !== newPageId && matchDomain(p.url || "", domain),
  );

  if (existingMatch) {
    // Found a pre-existing tab — use it and close the one we just created
    log(`found pre-existing tab after new_page: pageId=${existingMatch.id}, closing new pageId=${newPageId}`);
    domainPages.set(domain, existingMatch.id);
    await chrome.callTool("select_page", { pageId: existingMatch.id });
    if (newPageId !== undefined) {
      try { await chrome.callTool("close_page", { pageId: newPageId }); } catch {}
    }
    state.invalidateCache();
    return;
  }

  // No pre-existing match — keep the newly created tab
  if (newPageId !== undefined) {
    domainPages.set(domain, newPageId);
    await chrome.callTool("select_page", { pageId: newPageId });
  }

  if (!opts?.skipWait) {
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ─── Helpers ─────────────────────────────────────────────────

interface TabInfo {
  id: number;
  url: string;
  title: string;
}

function parsePagesResponse(result: any): TabInfo[] {
  if (result?.isError) return [];
  const text = extractText(result);
  const parsed = extractJson(text);
  if (!parsed) return [];
  const raw: any[] = Array.isArray(parsed) ? parsed : parsed?.pages || [];
  return raw
    .map((t: any) => ({
      id: t.id ?? t.pageId ?? -1,
      url: t.url || "",
      title: t.title || "",
    }))
    .filter((t) => t.id >= 0);
}

async function listTabs(chrome: ChromeClientInterface): Promise<TabInfo[]> {
  const result = await chrome.callTool("list_pages", {});
  const tabs = parsePagesResponse(result);
  if (tabs.length > 0) return tabs;

  // list_pages can fail with "selected page has been closed" —
  // retry once since the error is sometimes transient
  if (result?.isError || !extractJson(extractText(result))) {
    const retry = await chrome.callTool("list_pages", {});
    return parsePagesResponse(retry);
  }
  return [];
}

function matchDomain(tabUrl: string, domain: string): boolean {
  try {
    const u = new URL(tabUrl);
    const target = domain.includes(":") ? u.host : u.hostname;
    if (/^\d+\.\d+\.\d+\.\d+/.test(domain) || domain.startsWith("[")) {
      return target === domain;
    }
    return target === domain || target.endsWith("." + domain);
  } catch {
    return false;
  }
}

/** Clear cached page mappings (call on session destroy) */
export function clearDomainPages(): void {
  domainPages.clear();
}
