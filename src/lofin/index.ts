// 지방재정 (지방재정365) subsystem — registers lofin_* tools
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function registerLofinTools(server: McpServer): void {
  registerAllTools(server);
}
