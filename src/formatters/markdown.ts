/**
 * Convert extracted page content to clean Markdown.
 */
export function toMarkdown(data: {
  title?: string;
  headings?: Array<{ level: number; text: string }>;
  links?: Array<{ text: string; href: string }>;
  forms?: Array<{
    id: string;
    fields: Array<{ name: string; type: string; label: string }>;
  }>;
  content?: string;
}): string {
  const parts: string[] = [];

  if (data.title) {
    parts.push(`# ${data.title}\n`);
  }

  if (data.content) {
    // Truncate if too long
    const maxLen = 10000;
    const content =
      data.content.length > maxLen
        ? data.content.substring(0, maxLen) +
          `\n\n[... truncated, ${data.content.length - maxLen} more characters]`
        : data.content;
    parts.push(content);
  }

  if (data.links && data.links.length > 0) {
    parts.push("\n## Links\n");
    const uniqueLinks = data.links
      .filter((l) => l.text && l.href)
      .slice(0, 50);
    for (const link of uniqueLinks) {
      parts.push(`- [${link.text}](${link.href})`);
    }
  }

  if (data.forms && data.forms.length > 0) {
    parts.push("\n## Forms\n");
    for (const form of data.forms) {
      parts.push(`### Form: ${form.id || "(unnamed)"}`);
      for (const field of form.fields) {
        parts.push(
          `- ${field.label || field.name || "(unnamed)"} (${field.type})`
        );
      }
    }
  }

  return parts.join("\n");
}

/**
 * Format items as a Markdown table.
 */
export function toMarkdownTable(
  items: Record<string, any>[],
  maxRows = 50
): string {
  if (items.length === 0) return "(empty)";

  const keys = Object.keys(items[0]);
  const escapedKeys = keys.map((k) => k.replace(/\|/g, "\\|"));
  const header = `| ${escapedKeys.join(" | ")} |`;
  const separator = `| ${keys.map(() => "---").join(" | ")} |`;
  const rows = items.slice(0, maxRows).map((item) => {
    const values = keys.map((k) => {
      const v = item[k];
      return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    });
    return `| ${values.join(" | ")} |`;
  });

  const parts = [header, separator, ...rows];
  if (items.length > maxRows) {
    parts.push(`\n*... and ${items.length - maxRows} more rows*`);
  }
  return parts.join("\n");
}
