/**
 * Generate TypeScript or Python code from a recorded trace.
 */

import type { Trace, TraceEvent } from "./recorder.js";

export function generateTypeScript(trace: Trace): string {
  const funcName = toFuncName(trace.name);
  const lines = [
    `// Auto-generated from trace: ${trace.name}`,
    `// ${new Date(trace.startTime).toISOString()}`,
    ``,
    `import { ChromeClient } from "./chrome-client.js";`,
    `import { StateManager } from "./state.js";`,
    `import { makeContext } from "./context.js";`,
    ``,
    `async function ${funcName}() {`,
    `  const chrome = new ChromeClient();`,
    `  await chrome.connect();`,
    `  const ctx = makeContext(chrome, new StateManager());`,
    ``,
  ];

  for (let i = 0; i < trace.events.length; i++) {
    const e = trace.events[i];
    lines.push(`  // ${i + 1}. ${describeEvent(e)}`);
    lines.push(`  ${eventToTS(e)}`);
    lines.push(``);
  }

  lines.push(`  await chrome.disconnect();`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`${funcName}().catch(console.error);`);
  return lines.join("\n");
}

export function generatePython(trace: Trace): string {
  const funcName = toSnakeCase(trace.name);
  const lines = [
    `# Auto-generated from trace: ${trace.name}`,
    `# ${new Date(trace.startTime).toISOString()}`,
    ``,
    `import subprocess, json, sys, shlex`,
    ``,
    `def browser(cmd: str) -> dict:`,
    `    result = subprocess.run(["browser", *shlex.split(cmd), "--json"], capture_output=True, text=True)`,
    `    try: return json.loads(result.stdout)`,
    `    except: return {"success": False, "error": result.stderr}`,
    ``,
    `def ${funcName}():`,
  ];

  for (let i = 0; i < trace.events.length; i++) {
    const e = trace.events[i];
    lines.push(`    # ${i + 1}. ${describeEvent(e)}`);
    lines.push(`    ${eventToPython(e)}`);
    lines.push(``);
  }

  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    ${funcName}()`);
  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────

function describeEvent(e: TraceEvent): string {
  switch (e.type) {
    case "navigation": return `Navigate to ${e.url}`;
    case "click": return `Click [${e.role}] "${e.name}"`;
    case "fill": return `Fill [${e.role}] "${e.name}" with "${e.value}"`;
    case "select": return `Select [${e.role}] "${e.name}" = "${e.value}"`;
    case "check": return `${e.checked ? "Check" : "Uncheck"} [${e.role}] "${e.name}"`;
    case "press": return `Press ${e.key}`;
    case "scroll": return `Scroll ${e.direction} ${e.pixels}px`;
    default: return e.type;
  }
}

function eventToTS(e: TraceEvent): string {
  switch (e.type) {
    case "navigation":
      return `await ctx.run({ action: "browse", url: ${JSON.stringify(e.url)} });`;
    case "click":
      return `await ctx.run({ action: "click", target: ${JSON.stringify(e.ref || e.name)} });`;
    case "fill":
      return `await ctx.run({ action: "fill", target: ${JSON.stringify(e.ref || e.name)}, value: ${JSON.stringify(e.value || "")} });`;
    case "select":
      return `await ctx.run({ action: "select", target: ${JSON.stringify(e.ref || e.name)}, value: ${JSON.stringify(e.value || "")} });`;
    case "check":
      return `await ctx.run({ action: "click", target: ${JSON.stringify(e.ref || e.name)} });`;
    case "press":
      return `await ctx.run({ action: "press", value: ${JSON.stringify(e.key || "")} });`;
    case "scroll":
      return `await ctx.run({ action: "scroll", value: ${JSON.stringify(e.direction || "down")} });`;
    default:
      return `// unknown event: ${e.type}`;
  }
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function eventToPython(e: TraceEvent): string {
  switch (e.type) {
    case "navigation":
      return `browser("browse ${esc(e.url || "")}")`;
    case "click":
      return `browser('click "${esc(e.ref || e.name || "")}"')`;
    case "fill":
      return `browser('fill "${esc(e.ref || e.name || "")}" "${esc(e.value || "")}"')`;
    case "select":
      return `browser('select "${esc(e.ref || e.name || "")}" "${esc(e.value || "")}"')`;
    case "check":
      return `browser('click "${esc(e.ref || e.name || "")}"')`;
    case "press":
      return `browser("press ${esc(e.key || "")}")`;
    case "scroll":
      return `browser("scroll ${e.direction || "down"}")`;
    default:
      return `# unknown: ${e.type}`;
  }
}

function toFuncName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^(\d)/, "_$1") || "run";
}

function toSnakeCase(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_|_$/g, "").replace(/^(\d)/, "_$1") || "run";
}
