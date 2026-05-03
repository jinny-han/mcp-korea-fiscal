import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fiscalQuery, FiscalApiError } from "../client.js";
import { getApiSpec } from "../catalog.js";

const ParamValue = z.union([z.string(), z.number()]);

export function registerQueryTool(server: McpServer): void {
  server.tool(
    "lofin_query",
    "지방재정365 OpenAPI 데이터를 조회합니다. lofin_search로 얻은 서비스코드(code)와 검색 인자(params)를 전달하세요. 응답: { totalCount, rows, message }. INFO-200(데이터 없음)은 빈 rows로 정상 반환됩니다.",
    {
      code: z
        .string()
        .min(3)
        .max(20)
        .describe("서비스코드 (예: 'JFIED'). lofin_search 결과의 'code' 필드 그대로 사용"),
      params: z
        .record(ParamValue)
        .optional()
        .describe(
          "검색 인자. lofin_search 결과의 searchParams 스펙을 따름. 예: { fyr: 2024, laf_hg_nm: '서울종로구' }. 자치단체명은 '서울종로구' 형식 (광역+기초)",
        ),
      pIndex: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("페이지 번호 (기본 1)"),
      pSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("페이지당 건수 (기본 100, 최대 1000)"),
      type: z
        .enum(["json", "xml"])
        .optional()
        .describe("응답 형식 (기본 'json'). 'xml'을 지정하면 서버에 xml로 요청 후 자동 파싱"),
    },
    async (args) => {
      try {
        const result = await fiscalQuery({
          code: args.code,
          params: args.params,
          pIndex: args.pIndex,
          pSize: args.pSize,
          type: args.type,
        });

        const spec = getApiSpec(args.code);
        const sourceName = spec?.name ?? result.code;
        const payload = {
          source: `${sourceName} (지방재정365, 서비스코드: ${result.code})`,
          citation_hint:
            "사용자에게 답변할 때는 위 source의 한글 데이터셋명을 사용하세요. 코드(예: 'RHJDKD')는 내부 식별자이므로 사용자에게 직접 노출하지 마세요.",
          code: result.code,
          name: sourceName,
          category: spec?.category,
          totalCount: result.totalCount,
          returned: result.rows.length,
          pIndex: args.pIndex ?? 1,
          pSize: args.pSize ?? 100,
          message: result.message,
          rows: result.rows,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (err) {
        if (err instanceof FiscalApiError) {
          const hint =
            err.resultCode === "ERROR-310"
              ? "lofin_search로 올바른 서비스코드를 찾으세요."
              : err.resultCode === "ERROR-300"
                ? "필수 파라미터를 추가하세요. lofin_search 결과의 searchParams에서 required:true 항목을 확인하세요."
                : err.resultCode === "ERROR-290"
                  ? "환경변수 LOFIN_API_KEY를 확인하세요."
                  : err.resultCode === "ERROR-336"
                    ? "pSize를 1000 이하로 줄이세요."
                    : err.resultCode === "ERROR-337"
                      ? "일별 트래픽 한도 초과. 내일 다시 시도하세요."
                      : undefined;

          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { error: err.resultCode, message: err.resultMessage, hint },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "INTERNAL", message }) }],
        };
      }
    },
  );
}
