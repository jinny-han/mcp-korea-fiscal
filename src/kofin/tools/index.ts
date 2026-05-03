// src/tools/index.ts
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig } from "../config.js";
import { createFiscalClient } from "../api/client.js";
import { registerFiscalGuideTool } from "./fiscal-guide.js";
import { registerFiscalSearchTool } from "./fiscal-search.js";
import { registerFiscalQueryTool } from "./fiscal-query.js";

export function registerAllTools(server: McpServer, config: AppConfig): void {
  const client = createFiscalClient(config);
  registerFiscalGuideTool(server, config);
  registerFiscalSearchTool(server, config);
  registerFiscalQueryTool(server, config, client);
}
