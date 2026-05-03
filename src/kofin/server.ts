// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AppConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/templates.js";

export async function createServer(config: AppConfig): Promise<McpServer> {
  const server = new McpServer({
    name: "fiscal-api-mcp",
    version: "0.1.0",
  });

  registerAllTools(server, config);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
