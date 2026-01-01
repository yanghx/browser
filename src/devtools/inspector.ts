import type { ActionContext, BrowserActionResponse } from "../actions/types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

/**
 * Inspect page elements by CSS selector, text search, or show full snapshot.
 */
export async function inspect(
  selector: string | undefined,
  ctx: ActionContext
): Promise<BrowserActionResponse> {
  if (!selector) {
    // No selector: return page overview
    const result = await ctx.run({ action: "snapshot" });
    return {
      success: true,
      action: "dev",
      data: {
        content: result.data?.content || "",
        elements: result.data?.elements,
      },
    };
  }

  // Text search (":text(...)")
  if (selector.startsWith(":text(")) {
    const text = selector.match(/:text\("?([^"]*)"?\)/)?.[1] || "";
    return ctx.run({ action: "search", target: text });
  }

  // CSS selector: use evaluate_script to find elements
  const script = `(sel) => {
    const els = document.querySelectorAll(sel);
    return [...els].slice(0, 30).map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: (el.className && typeof el.className === 'string') ? el.className.split(' ').filter(Boolean).slice(0, 3).join('.') : undefined,
      text: el.textContent?.trim()?.substring(0, 100) || '',
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      type: el.getAttribute('type') || undefined,
      href: el.getAttribute('href') || undefined,
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
  }`;

  const result = await ctx.chrome.callTool("evaluate_script", {
    function: script,
    args: [selector],
  });

  const text = extractText(result);
  const elements: any[] = extractJson(text) || [];

  if (!Array.isArray(elements) || elements.length === 0) {
    return {
      success: true,
      action: "dev",
      data: { content: `No elements found matching "${selector}"` },
    };
  }

  // Also cross-reference with snapshot to get UIDs
  const snapshotResult = await ctx.run({ action: "snapshot" });
  const snapshotElements = snapshotResult.data?.elements || [];

  const lines = elements.map((el: any) => {
    // Try to find UID by matching text/role
    const uid = snapshotElements.find(
      (se: any) =>
        (el.ariaLabel && se.name === el.ariaLabel) ||
        (el.text && se.name === el.text.substring(0, 50))
    );

    const parts = [
      `[${el.index}]`,
      `<${el.tag}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className}` : ""}>`,
      el.text ? `"${el.text}"` : "",
    ];
    if (uid) parts.push(`UID: ${uid.uid}`);
    if (el.role) parts.push(`Role: ${el.role}`);
    if (el.type) parts.push(`Type: ${el.type}`);
    if (el.href) parts.push(`Href: ${el.href.substring(0, 60)}`);
    parts.push(`(${el.rect.w}x${el.rect.h} @${el.rect.x},${el.rect.y})`);

    return parts.filter(Boolean).join("  ");
  });

  return {
    success: true,
    action: "dev",
    data: {
      content: `Found ${elements.length} element(s) matching "${selector}":\n\n${lines.join("\n")}`,
      items: elements,
    },
  };
}
