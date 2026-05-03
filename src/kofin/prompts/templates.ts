// src/prompts/templates.ts
import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "재정데이터_수집_워크플로우",
    "재정 도메인 데이터를 체계적으로 수집하는 워크플로우",
    { year: z.string().optional().describe("수집 연도 (기본: 2024)") },
    async ({ year }) => {
      const targetYear = year ?? "2024";
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `재정 도메인 데이터를 체계적으로 수집해주세요. 대상 연도: ${targetYear}`,
              "",
              "수집 순서:",
              "1. discover_fiscal(category='budget') → 수집 가능한 예산 API 확인",
              "2. fiscal_ministry() → 부처 목록 및 코드 확보",
              `3. fiscal_program(year=${targetYear}) → 재정사업 목록 수집`,
              `4. fiscal_budget(year=${targetYear}) → 예산 데이터 수집`,
              `5. fiscal_settlement(year=${String(Number(targetYear) - 1)}) → 결산 데이터 수집`,
              "6. fiscal_stats(stat_type='totals') → 재정총량 통계 수집",
            ].join("\n"),
          },
        }],
      };
    },
  );

  server.prompt(
    "부처별_재정현황_수집",
    "특정 부처의 재정현황을 전방위 수집",
    {
      ministry_name: z.string().describe("부처명 (예: 기재부, 교육부)"),
      year: z.string().optional().describe("회계연도 (기본: 2024)"),
    },
    async ({ ministry_name, year }) => {
      const targetYear = year ?? "2024";
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `${ministry_name}의 재정현황을 전방위 수집해주세요.`,
              "",
              "수집 순서:",
              `1. fiscal_ministry(ministry_name="${ministry_name}") → ministry_code 확보`,
              `2. fiscal_budget(ministry_code=..., year=${targetYear}) → 예산`,
              `3. fiscal_settlement(ministry_code=..., year=${String(Number(targetYear) - 1)}) → 결산`,
              "4. fiscal_program(ministry_code=...) → 소관 재정사업 목록",
            ].join("\n"),
          },
        }],
      };
    },
  );
}
