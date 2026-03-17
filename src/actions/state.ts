import type { ActionHandler } from "./types.js";
import { extractText, extractJson } from "../formatters/json-cleaner.js";

export const stateAction: ActionHandler = async (_request, ctx) => {
  try {
    // Get page info and console errors in parallel
    const [pageResult, consoleResult] = await Promise.all([
      ctx.chrome.callTool("evaluate_script", {
        function: `() => ({
          title: document.title,
          url: location.href,
          links: document.querySelectorAll('a').length,
          forms: document.querySelectorAll('form').length,
          inputs: document.querySelectorAll('input,textarea,select').length,
          buttons: document.querySelectorAll('button,[role="button"]').length,
          images: document.querySelectorAll('img').length,
          headings: document.querySelectorAll('h1,h2,h3').length,
        })`,
      }),
      ctx.chrome.callTool("list_console_messages", { types: ["error"] }),
    ]);

    const pageText = extractText(pageResult);
    const pageInfo: any = extractJson(pageText) || {};

    const consoleText = extractText(consoleResult);
    const consoleData = extractJson(consoleText);
    // list_console_messages may return text lines instead of JSON array
    const errorCount = Array.isArray(consoleData)
      ? consoleData.length
      : consoleData == null
        ? consoleText.split("\n").filter((l) => l.trim()).length
        : 0;

    const summary = [
      `Links: ${pageInfo.links || 0}`,
      `Forms: ${pageInfo.forms || 0}`,
      `Inputs: ${pageInfo.inputs || 0}`,
      `Buttons: ${pageInfo.buttons || 0}`,
      `Images: ${pageInfo.images || 0}`,
      `Headings: ${pageInfo.headings || 0}`,
      `Console Errors: ${errorCount}`,
    ].join(", ");

    return {
      success: true,
      action: "state",
      data: {
        title: pageInfo.title || "",
        url: pageInfo.url || "",
        content: summary,
      },
    };
  } catch (err: any) {
    return { success: false, action: "state", error: err.message || String(err) };
  }
};
