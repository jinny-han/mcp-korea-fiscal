#!/usr/bin/env node
// mcp-korea-fiscal — unified MCP for Korean public fiscal data
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerKofinTools } from "./kofin/index.js";
import { registerLofinTools } from "./lofin/index.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "mcp-korea-fiscal",
    version: "0.1.0",
  });

  const registered: string[] = [];
  const skipped: string[] = [];

  try {
    registerKofinTools(server);
    registered.push("kofin (국가재정)");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    skipped.push(`kofin: ${message}`);
  }

  try {
    registerLofinTools(server);
    registered.push("lofin (지방재정)");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    skipped.push(`lofin: ${message}`);
  }

  if (registered.length === 0) {
    process.stderr.write(
      `[mcp-korea-fiscal] 등록된 도구가 없습니다. 환경변수(OPENFISCAL_API_KEY 또는 LOFIN_API_KEY)를 확인하세요.\n`,
    );
    for (const s of skipped) process.stderr.write(`  - ${s}\n`);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[mcp-korea-fiscal] MCP 서버 시작 (stdio). 등록: ${registered.join(", ")}\n`,
  );
  for (const s of skipped) {
    process.stderr.write(`[mcp-korea-fiscal] skipped — ${s}\n`);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mcp-korea-fiscal] 시작 실패: ${message}\n`);
  process.exit(1);
});
