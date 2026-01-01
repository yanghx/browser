import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChromeClientInterface } from "./actions/types.js";

export class ChromeClient implements ChromeClientInterface {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor() {
    this.client = new Client({
      name: "browser",
      version: "0.1.0",
    });
  }

  async connect(config?: {
    command?: string;
    args?: string[];
  }): Promise<void> {
    if (this.connected) return;

    const command = config?.command ?? "npx";

    // Default args: connect to existing Chrome via remote debugging port if
    // BROWSER_URL is set, otherwise use --autoConnect.
    // Using --browserUrl avoids the Chrome "allow" dialog on every connection.
    const browserUrl = process.env.BROWSER_URL;
    const defaultArgs = browserUrl
      ? ["chrome-devtools-mcp@latest", "--browserUrl", browserUrl]
      : ["chrome-devtools-mcp@latest", "--autoConnect"];

    const args = config?.args ?? defaultArgs;

    this.transport = new StdioClientTransport({ command, args });
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
    this.transport = null;
  }

  async callTool(name: string, args?: Record<string, any>): Promise<any> {
    if (!this.connected) {
      throw new Error("ChromeClient not connected. Call connect() first.");
    }
    const result = await this.client.callTool({
      name,
      arguments: args ?? {},
    });
    return result;
  }

  // Convenience methods for common Chrome MCP tools

  async navigatePage(opts: {
    url?: string;
    type?: "url" | "back" | "forward" | "reload";
    initScript?: string;
  }) {
    return this.callTool("navigate_page", opts);
  }

  async newPage(url: string) {
    return this.callTool("new_page", { url });
  }

  async closePage(pageId: number) {
    return this.callTool("close_page", { pageId });
  }

  async selectPage(pageId: number) {
    return this.callTool("select_page", { pageId });
  }

  async listPages() {
    return this.callTool("list_pages");
  }

  async click(uid: string, opts?: { includeSnapshot?: boolean }) {
    return this.callTool("click", { uid, ...opts });
  }

  async fill(uid: string, value: string, opts?: { includeSnapshot?: boolean }) {
    return this.callTool("fill", { uid, value, ...opts });
  }

  async fillForm(
    elements: Array<{ uid: string; value: string }>,
    opts?: { includeSnapshot?: boolean }
  ) {
    return this.callTool("fill_form", { elements, ...opts });
  }

  async hover(uid: string) {
    return this.callTool("hover", { uid });
  }

  async pressKey(key: string) {
    return this.callTool("press_key", { key });
  }

  async typeText(text: string, opts?: { submitKey?: string }) {
    return this.callTool("type_text", { text, ...opts });
  }

  async drag(fromUid: string, toUid: string) {
    return this.callTool("drag", { from_uid: fromUid, to_uid: toUid });
  }

  async uploadFile(uid: string, filePath: string) {
    return this.callTool("upload_file", { uid, filePath });
  }

  async handleDialog(action: "accept" | "dismiss", promptText?: string) {
    return this.callTool("handle_dialog", { action, promptText });
  }

  async takeSnapshot(opts?: { verbose?: boolean; filePath?: string }) {
    return this.callTool("take_snapshot", opts);
  }

  async takeScreenshot(opts?: {
    fullPage?: boolean;
    uid?: string;
    format?: string;
    filePath?: string;
  }) {
    return this.callTool("take_screenshot", opts);
  }

  async waitFor(text: string[], timeout?: number) {
    return this.callTool("wait_for", { text, timeout });
  }

  async listNetworkRequests(opts?: {
    resourceTypes?: string[];
    pageSize?: number;
  }) {
    return this.callTool("list_network_requests", opts);
  }

  async getNetworkRequest(reqid?: number) {
    return this.callTool("get_network_request", reqid != null ? { reqid } : {});
  }

  async listConsoleMessages(opts?: { types?: string[] }) {
    return this.callTool("list_console_messages", opts);
  }

  async getConsoleMessage(msgid: number) {
    return this.callTool("get_console_message", { msgid });
  }

  async evaluateScript(fn: string, args?: string[]) {
    return this.callTool("evaluate_script", { function: fn, args });
  }

  async emulate(opts: Record<string, any>) {
    return this.callTool("emulate", opts);
  }

  async resizePage(width: number, height: number) {
    return this.callTool("resize_page", { width, height });
  }
}
