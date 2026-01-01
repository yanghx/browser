import type { ActionContext, BrowserActionResponse } from "../actions/types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

/**
 * Test a CSS selector and optionally extract structured data from matched elements.
 */
export async function testSelector(
  selector: string,
  extract: boolean,
  ctx: ActionContext
): Promise<BrowserActionResponse> {
  if (!selector) {
    return { success: false, action: "dev", error: "selector is required" };
  }

  if (extract) {
    // Use the extract action
    const result = await ctx.run({ action: "extract", selector });
    return {
      success: true,
      action: "dev",
      data: {
        content: `Extract test for "${selector}":\n\n${result.data?.content || "No data"}`,
        items: result.data?.items,
      },
    };
  }

  // Just test the selector and return match count + preview
  const script = `(sel) => {
    const els = document.querySelectorAll(sel);
    const count = els.length;
    const preview = [...els].slice(0, 5).map(el => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim()?.substring(0, 150) || '',
      childCount: el.children.length,
      attributes: Object.fromEntries(
        [...el.attributes].slice(0, 5).map(a => [a.name, a.value.substring(0, 50)])
      ),
    }));
    return { count, preview };
  }`;

  const result = await ctx.chrome.callTool("evaluate_script", {
    function: script,
    args: [selector],
  });

  const text = extractText(result);
  const data: any = extractJson(text) || {};

  const lines = [`Selector: \`${selector}\``, `Matches: ${data.count || 0}`, ""];

  if (data.preview?.length) {
    for (const el of data.preview) {
      const attrs = Object.entries(el.attributes || {})
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      lines.push(`  <${el.tag} ${attrs}>`);
      lines.push(`    Text: "${el.text}"`);
      lines.push(`    Children: ${el.childCount}`);
      lines.push("");
    }
    if (data.count > 5) {
      lines.push(`  ... and ${data.count - 5} more`);
    }
  }

  return {
    success: true,
    action: "dev",
    data: {
      content: lines.join("\n"),
      items: data.preview,
    },
  };
}

/**
 * Test a JS script snippet and return the result.
 */
export async function testScript(
  script: string,
  ctx: ActionContext
): Promise<BrowserActionResponse> {
  return ctx.run({ action: "eval", script });
}
