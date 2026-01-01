import type { ActionHandler } from "./types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const evalAction: ActionHandler = async (request, ctx) => {
  const script = request.script;
  if (!script) return { success: false, action: "eval", error: "script is required" };

  try {
    // Chrome DevTools MCP requires a snapshot before evaluate_script works
    if (!ctx.state.getCachedSnapshot()) {
      await ctx.chrome.callTool("take_snapshot", {});
    }

    // Chrome MCP's evaluate_script 'args' are element UIDs, not general params.
    // We must embed the script inline. Escape backticks and ${} to prevent
    // template literal injection when the script is placed in the function body.
    const safeScript = script
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${");

    const wrapper = `async () => {
  try {
    const __userScript = \`${safeScript}\`;
    let __fn;
    try {
      __fn = new Function('return (async () => { return (' + __userScript + ') })()');
    } catch {
      __fn = new Function('return (async () => { ' + __userScript + ' })()');
    }
    const __result = await __fn();
    if (__result instanceof HTMLElement) {
      return { tag: __result.tagName, text: __result.textContent?.substring(0, 1000), id: __result.id };
    }
    if (__result instanceof NodeList || __result instanceof HTMLCollection) {
      return [...__result].slice(0, 50).map(n => n.textContent?.substring(0, 200));
    }
    return __result;
  } catch (e) {
    return { error: e.message, stack: e.stack?.substring(0, 500) };
  }
}`;

    const result = await ctx.chrome.callTool("evaluate_script", {
      function: wrapper,
    });

    const text = extractText(result);
    const parsed: any = extractJson(text) ?? text;

    if (parsed?.error) {
      return { success: false, action: "eval", error: parsed.error };
    }

    return {
      success: true,
      action: "eval",
      data: { result: parsed },
    };
  } catch (err: any) {
    return { success: false, action: "eval", error: err.message || String(err) };
  }
};
