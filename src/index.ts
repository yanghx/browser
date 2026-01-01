#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./server.js";

async function main() {
  const server = new McpServer({
    name: "browser",
    version: "0.1.0",
  });

  // Register the "browser" tool — routes all calls through daemon
  await registerTools(server);

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
