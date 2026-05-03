import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGuideTool } from "./guide.js";
import { registerSearchTool } from "./search.js";
import { registerQueryTool } from "./query.js";

export function registerAllTools(server: McpServer): void {
  registerGuideTool(server);
  registerSearchTool(server);
  registerQueryTool(server);
}
