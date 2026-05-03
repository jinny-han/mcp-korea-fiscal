// src/tools/fiscal-search.ts
import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig } from "../config.js";
import { FISCAL_CATALOG, type FiscalCategory } from "../api/catalog.js";

export function registerFiscalSearchTool(
  server: McpServer,
  _config: AppConfig,
): void {
  server.tool(
    "kofin_search",
    `키워드 또는 카테고리로 열린재정 API를 검색합니다.
검색 결과에서 code를 확인한 뒤 kofin_query로 데이터를 호출하세요.
예: kofin_search(keyword="국가채무") → code 확인 → kofin_query(api_code=..., params={...})`,
    {
      keyword: z.string().optional().describe("검색 키워드 (예: 국가채무, 교부세, 재정상태표, 추경)"),
      category: z
        .enum(["budget", "settlement", "execution", "stats", "project", "levy"])
        .optional()
        .describe("카테고리 필터: budget(예산) / settlement(결산·재무제표) / execution(집행) / stats(재정통계) / project(총사업비) / levy(부담금)"),
    },
    async (params) => {
      if (!params.keyword && !params.category) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "keyword 또는 category 중 하나는 입력해주세요." }),
          }],
          isError: true,
        };
      }

      let results = [...FISCAL_CATALOG];

      if (params.category) {
        results = results.filter(e => e.category === params.category);
      }

      if (params.keyword) {
        const lower = params.keyword.toLowerCase();
        results = results.filter(e =>
          e.name.toLowerCase().includes(lower) ||
          e.description.toLowerCase().includes(lower) ||
          e.code.toLowerCase().includes(lower) ||
          e.requiredParams.some(p => p.toLowerCase().includes(lower)) ||
          e.optionalParams.some(p => p.toLowerCase().includes(lower))
        );
      }

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              results: [],
              message: "검색 결과가 없습니다. kofin_guide로 카테고리 전체를 확인해보세요.",
            }),
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total: results.length,
            results: results.map(e => ({
              code: e.code,
              name: e.name,
              category: e.category,
              description: e.description,
              requiredParams: e.requiredParams,
              optionalParams: e.optionalParams,
            })),
          }),
        }],
      };
    },
  );
}
