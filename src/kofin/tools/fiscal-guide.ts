// src/tools/fiscal-guide.ts
import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig } from "../config.js";
import { FISCAL_CATALOG, type FiscalCategory } from "../api/catalog.js";

const CAT_LABELS: Record<FiscalCategory, string> = {
  budget:     "예산 (39개) — 세출·세입 예산편성현황, 추경 포함",
  settlement: "결산·재무제표 (33개) — 세입/세출 결산, 재정상태표·운영표, GFS",
  execution:  "집행 (17개) — 월별/일별 수입·지출 집행·운용 현황",
  stats:      "재정통계 (66개) — 채무·채권·출자·기금·추이·중기재정 등",
  project:    "총사업비 (1개) — 총사업비 관리대상 사업 현황",
  levy:       "부담금 (1개) — 부담금 운용 현황",
};

export function registerFiscalGuideTool(
  server: McpServer,
  _config: AppConfig,
): void {
  server.tool(
    "kofin_guide",
    `열린재정 OpenAPI 전체 카탈로그(157개)를 카테고리별로 안내합니다.
category 없이 호출하면 카테고리 요약을 반환합니다.
category를 지정하면 해당 카테고리의 전체 API 목록(코드·이름·필수파라미터)을 반환합니다.
데이터를 찾을 때: kofin_guide → kofin_search → kofin_query 순서로 사용하세요.`,
    {
      category: z
        .enum(["budget", "settlement", "execution", "stats", "project", "levy"])
        .optional()
        .describe("카테고리 지정 시 해당 API 전체 목록 반환. 생략 시 카테고리 요약만 반환."),
    },
    async (params) => {
      if (!params.category) {
        // 카테고리 요약 반환
        const summary = (Object.entries(CAT_LABELS) as [FiscalCategory, string][]).map(([cat, label]) => {
          const items = FISCAL_CATALOG.filter(e => e.category === cat);
          const examples = items.slice(0, 3).map(e => e.name);
          return { category: cat, label, count: items.length, examples };
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              total: FISCAL_CATALOG.length,
              usage: "category를 지정해 API 목록 확인 → kofin_search로 검색 → kofin_query로 호출",
              categories: summary,
            }),
          }],
        };
      }

      // 카테고리별 전체 목록
      const items = FISCAL_CATALOG.filter(e => e.category === params.category);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            category: params.category,
            label: CAT_LABELS[params.category],
            count: items.length,
            apis: items.map(e => ({
              code: e.code,
              name: e.name,
              requiredParams: e.requiredParams,
              optionalParams: e.optionalParams,
            })),
          }),
        }],
      };
    },
  );
}
