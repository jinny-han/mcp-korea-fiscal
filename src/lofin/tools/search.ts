import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchCatalog, listCategories, type ApiSpec } from "../catalog.js";

function summarize(spec: ApiSpec): Record<string, unknown> {
  return {
    code: spec.code,
    name: spec.name,
    category: spec.category,
    years: spec.years,
    description: spec.description,
    endpoint: spec.endpoint,
    searchParams: spec.searchParams.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required,
      description: p.description,
    })),
    outputCols: spec.outputCols.map((c) => ({ id: c.id, name: c.name })),
  };
}

export function registerSearchTool(server: McpServer): void {
  server.tool(
    "lofin_search",
    "지방재정365 OpenAPI 카탈로그(146개)를 검색합니다. 키워드/카테고리/연도로 필터. 결과에 lofin_query 호출에 필요한 서비스코드와 검색 파라미터 스펙이 포함됩니다.",
    {
      q: z
        .string()
        .optional()
        .describe("키워드. name/description/tags/category/code 부분 매칭 (대소문자 무시)"),
      category: z
        .string()
        .optional()
        .describe(
          "카테고리 정확 매칭. 예: '재정여건(예산)', '지방세', '재정운용계획'. lofin_guide({topic:'categories'})로 전체 목록 확인",
        ),
      year: z
        .number()
        .int()
        .optional()
        .describe("보유연도가 이 연도를 포함하는 API만. 예: 2024"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(146)
        .optional()
        .describe("결과 최대 개수 (기본 20)"),
    },
    async (args) => {
      const results = searchCatalog({
        q: args.q,
        category: args.category,
        year: args.year,
        limit: args.limit ?? 20,
      });

      const payload = {
        total: results.length,
        results: results.map(summarize),
        hint:
          results.length === 0
            ? `매칭 결과 없음. 카테고리 목록은 lofin_guide({topic:'categories'})로 확인하세요. 가능한 카테고리: ${listCategories()
                .map((c) => c.category)
                .join(", ")}`
            : "원하는 항목의 'code'를 lofin_query에 넣어 데이터를 조회하세요.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
