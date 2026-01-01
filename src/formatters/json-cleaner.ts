/**
 * Extract text content from an MCP tool result.
 * Chrome MCP returns results in the standard MCP format:
 *   { content: [{ type: "text", text: "..." }, { type: "image", ... }] }
 */
export function extractText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;

  // MCP CallToolResult format
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }

  return JSON.stringify(result);
}

/**
 * Extract JSON from Chrome MCP text responses.
 * Chrome MCP often wraps JSON in markdown code blocks like:
 *   "Script ran on page and returned:\n```json\n{...}\n```"
 * This function extracts the JSON from such responses.
 */
export function extractJson(text: string): any {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // ignore
    }
  }

  // Try finding first { or [ and parse from there
  const jsonStart = text.search(/[{\[]/);
  if (jsonStart >= 0) {
    try {
      return JSON.parse(text.substring(jsonStart));
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Extract image data (base64) from an MCP tool result.
 */
export function extractImage(result: any): string | null {
  if (!result?.content || !Array.isArray(result.content)) return null;
  const img = result.content.find((c: any) => c.type === "image");
  return img?.data ?? null;
}

/**
 * Clean a JSON object by removing null/undefined/empty values.
 */
export function cleanJson(obj: any, maxStringLen = 500): any {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === "string") {
    return obj.length > maxStringLen
      ? obj.substring(0, maxStringLen) + "..."
      : obj;
  }
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => cleanJson(item, maxStringLen)).filter((v) => v !== undefined);
  }

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const v = cleanJson(value, maxStringLen);
    if (v !== undefined && v !== "" && v !== null) {
      cleaned[key] = v;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
