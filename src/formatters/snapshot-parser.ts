import type { ElementInfo, ParsedSnapshot } from "../actions/types.js";

/**
 * Parse the Chrome MCP a11y tree text snapshot into structured elements.
 *
 * Chrome DevTools MCP snapshot format:
 *   uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
 *   uid=1_1 heading "Example Domain" level="1"
 *   uid=1_3 link "Learn more" url="..."
 */
export function parseSnapshot(raw: string): ParsedSnapshot {
  const elements: ElementInfo[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Chrome DevTools MCP format: uid=<id> <role> "name" [attrs...]
    const match = trimmed.match(
      /uid=([^\s]+)\s+([\w]+)\s*(?:"([^"]*)")?/
    );
    if (match) {
      const [, uid, role, name] = match;
      elements.push({
        uid,
        role,
        name: name ?? "",
        text: name ?? "",
      });
    }
  }

  return {
    raw,
    elements,
    timestamp: Date.now(),
  };
}

/**
 * Extract only interactive elements from a parsed snapshot.
 */
export function getInteractiveElements(
  snapshot: ParsedSnapshot
): ElementInfo[] {
  const interactiveRoles = new Set([
    "button",
    "link",
    "textbox",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "spinbutton",
    "searchbox",
    "menuitem",
    "option",
    "tab",
  ]);
  return snapshot.elements.filter((el) => interactiveRoles.has(el.role));
}
