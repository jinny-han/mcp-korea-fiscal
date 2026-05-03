// src/tools/fiscal-query.ts
import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig } from "../config.js";
import { createFiscalClient } from "../api/client.js";
import { FISCAL_CATALOG } from "../api/catalog.js";

export function registerFiscalQueryTool(
  server: McpServer,
  config: AppConfig,
  client: ReturnType<typeof createFiscalClient>,
): void {
  server.tool(
    "kofin_query",
    `열린재정 API를 호출해 데이터를 조회합니다.
api_code는 kofin_search 또는 kofin_guide로 먼저 확인하세요.
page_size 기본값은 100입니다 (최대 1000).`,
    {
      api_code: z.string().describe("API 코드 (kofin_search로 확인)"),
      params: z
        .record(z.union([z.string(), z.number()]))
        .optional()
        .describe("쿼리 파라미터 (예: {FSCL_YY: 2024, OFFC_NM: '교육부'})"),
      page: z.number().optional().describe("페이지 번호 (기본: 1)"),
      page_size: z.number().optional().describe("페이지당 건수 (기본: 100, 최대: 1000)"),
    },
    async (input) => {
      try {
        const entry = FISCAL_CATALOG.find(e => e.code === input.api_code);
        const queryParams: Record<string, string | number> = {
          ...(input.params ?? {}),
          pIndex: input.page ?? 1,
          pSize: input.page_size ?? 100,
        };

        const result = await client.fetchOpenFiscal(input.api_code, queryParams);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              api_code: input.api_code,
              name: entry?.name ?? input.api_code,
              totalCount: result.totalCount,
              page: input.page ?? 1,
              page_size: input.page_size ?? 100,
              rows: result.rows,
            }),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // 필수 파라미터 누락 힌트
        const entry = FISCAL_CATALOG.find(e => e.code === input.api_code);
        const hint = entry?.requiredParams.length
          ? `필수 파라미터: ${entry.requiredParams.join(", ")}`
          : undefined;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: message, ...(hint ? { hint } : {}) }),
          }],
          isError: true,
        };
      }
    },
  );
}
