import type { ActionHandler } from "./types.js";
import { inspect } from "../devtools/inspector.js";
import { testSelector, testScript } from "../devtools/selector-tester.js";
import { captureNetworkLog } from "../devtools/network-logger.js";
import { traceStart, traceStop, traceStatus, deserializeTrace, serializeTrace } from "../devtools/recorder.js";
import { generateTypeScript, generatePython } from "../devtools/codegen.js";
import { generateSiteCLI } from "../devtools/cli-generator.js";
import { readFile, writeFile } from "fs/promises";

export const devAction: ActionHandler = async (request, ctx) => {
  const { devAction: action, selector, script, resourceTypes, urlPattern, output, lang } = request;

  if (!action) {
    return {
      success: true,
      action: "dev",
      data: {
        content: [
          "Available dev actions:",
          "",
          "  trace start              - Start recording user interactions in browser",
          "  trace stop               - Stop recording, show captured events",
          "  trace status             - Check recording state",
          "  codegen <file>           - Generate TS/Python code from trace JSON",
          "  inspect [selector]       - Inspect page elements",
          '  test-selector <sel>      - Test CSS selector (add --extract for data)',
          "  test-script <js>         - Test JavaScript snippet",
          "  network-log              - Capture network requests for API discovery",
          "  cli <url> [--output dir] - Reverse-engineer site API → generate @params recipe",
        ].join("\n"),
      },
    };
  }

  switch (action) {
    case "inspect":
      return inspect(selector || request.target, ctx);

    case "test-selector":
      return testSelector(
        selector || request.target || "",
        !!request.args?.extract,
        ctx
      );

    case "test-script":
      return testScript(script || request.target || "", ctx);

    case "network-log":
      return captureNetworkLog(resourceTypes, urlPattern, ctx);

    // ── Trace (replaces old record/replay) ──

    case "record":
    case "trace": {
      const sub = request.target || request.selector || "start";
      if (sub === "start") return traceStart(ctx);
      if (sub === "stop") return traceStop(ctx);
      if (sub === "status") return traceStatus(ctx);
      return { success: false, action: "dev", error: `Unknown trace sub-command: ${sub}. Use: start, stop, status` };
    }

    case "replay": {
      // Replay a saved trace by re-executing each event
      const file = request.target || request.output;
      if (!file) return { success: false, action: "dev", error: "File path required" };
      try {
        const json = await readFile(file, "utf-8");
        const trace = deserializeTrace(json);
        const results: string[] = [];
        for (let i = 0; i < trace.events.length; i++) {
          const e = trace.events[i];
          let res;
          switch (e.type) {
            case "navigation": res = await ctx.run({ action: "browse", url: e.url }); break;
            case "click": res = await ctx.run({ action: "click", target: e.ref || e.name || "" }); break;
            case "fill": res = await ctx.run({ action: "fill", target: e.ref || e.name || "", value: e.value || "" }); break;
            case "select": res = await ctx.run({ action: "select", target: e.ref || e.name || "", value: e.value || "" }); break;
            case "check": res = await ctx.run({ action: "click", target: e.ref || e.name || "" }); break;
            case "press": res = await ctx.run({ action: "press", value: e.key || "" }); break;
            case "scroll": res = await ctx.run({ action: "scroll", value: e.direction || "down" }); break;
            default: res = { success: true }; break;
          }
          const status = (res as any).success ? "✓" : "✗";
          results.push(`${status} ${i + 1}. ${e.type}${e.ref ? ` ${e.ref}` : ""}${e.value ? ` "${e.value}"` : ""}`);
        }
        return { success: true, action: "dev", data: { content: `Replay complete (${trace.events.length} events):\n\n${results.join("\n")}` } };
      } catch (err: any) {
        return { success: false, action: "dev", error: `Replay failed: ${err.message}` };
      }
    }

    case "codegen": {
      const file = request.target;
      if (!file) return { success: false, action: "dev", error: "Trace file path required" };
      try {
        const json = await readFile(file, "utf-8");
        const trace = deserializeTrace(json);
        const code = (lang || "ts") === "python" ? generatePython(trace) : generateTypeScript(trace);
        if (output) {
          await writeFile(output, code, "utf-8");
          return { success: true, action: "dev", data: { content: `Code saved to: ${output}` } };
        }
        return { success: true, action: "dev", data: { content: code } };
      } catch (err: any) {
        return { success: false, action: "dev", error: `Codegen failed: ${err.message}` };
      }
    }

    case "cli": {
      const url = request.url || request.target;
      if (!url) return { success: false, action: "dev", error: "URL required. Usage: browser cli <url>" };
      return generateSiteCLI(url, ctx, output);
    }

    default:
      return { success: false, action: "dev", error: `Unknown dev action: ${action}` };
  }
};
