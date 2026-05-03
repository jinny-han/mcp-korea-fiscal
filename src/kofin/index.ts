// 국가재정 (열린재정) subsystem — registers kofin_* tools
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/templates.js";

export function registerKofinTools(server: McpServer): void {
  const config = loadConfig();
  registerAllTools(server, config);
  registerPrompts(server);
}
