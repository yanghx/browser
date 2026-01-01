import type {
  ActionContext,
  ElementInfo,
  ParsedSnapshot,
} from "../actions/types.js";
import { parseSnapshot } from "../formatters/snapshot-parser.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

/**
 * Resolve a target (UID, CSS selector, or text description) to a snapshot UID.
 *
 * Priority:
 * 1. Already a UID format → use directly
 * 2. CSS selector → evaluate_script to find → cross-reference snapshot
 * 3. Text description → search snapshot name/text → prefer interactive elements
 */
export async function resolveTarget(
  target: string,
  ctx: ActionContext
): Promise<string> {
  // Ensure we have a fresh snapshot
  const snapshot = await ensureSnapshot(ctx);

  // 1. Check if target looks like a UID (short alphanumeric)
  const uidMatch = snapshot.elements.find(
    (el) => el.uid.toLowerCase() === target.toLowerCase()
  );
  if (uidMatch) return uidMatch.uid;

  // 2. Check if target looks like a CSS selector
  if (looksLikeSelector(target)) {
    // Use JS to find the element text, then match against snapshot
    const result = await ctx.chrome.callTool("evaluate_script", {
      function: `(sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return {
          text: el.textContent?.trim()?.substring(0, 200) || '',
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || ''
        };
      }`,
      args: [target],
    });

    const text = extractText(result);
    const elInfo = extractJson(text);
    if (elInfo) {
      const match = findBestMatch(snapshot.elements, elInfo.text || elInfo.ariaLabel);
      if (match) return match.uid;
    }
  }

  // 3. Text description search
  const match = findBestMatch(snapshot.elements, target);
  if (match) return match.uid;

  throw new Error(
    `Could not resolve target "${target}" to a page element. ` +
      `Try using a UID from snapshot, a CSS selector, or more specific text.`
  );
}

async function ensureSnapshot(ctx: ActionContext): Promise<ParsedSnapshot> {
  const cached = ctx.state.getCachedSnapshot();
  if (cached) return cached;

  const result = await ctx.chrome.callTool("take_snapshot", {});
  const raw = extractText(result);
  const snapshot = parseSnapshot(raw);
  ctx.state.setCachedSnapshot(snapshot);
  return snapshot;
}

function looksLikeSelector(target: string): boolean {
  // CSS selectors typically contain . # [ ] > : = or start with a tag name
  return /^[.#\[]|[.#\[\]>:=+~]/.test(target);
}

function findBestMatch(
  elements: ElementInfo[],
  text: string
): ElementInfo | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Exact match on name
  const exact = elements.find((el) => el.name.toLowerCase() === lower);
  if (exact) return exact;

  // Contains match - prefer interactive elements
  const interactiveRoles = new Set([
    "button", "link", "textbox", "combobox", "checkbox",
    "radio", "switch", "menuitem", "option", "tab", "searchbox",
  ]);

  const matches = elements.filter(
    (el) =>
      el.name.toLowerCase().includes(lower) ||
      el.text.toLowerCase().includes(lower)
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Prefer interactive elements
  const interactive = matches.filter((m) => interactiveRoles.has(m.role));
  if (interactive.length > 0) return interactive[0];

  return matches[0];
}
