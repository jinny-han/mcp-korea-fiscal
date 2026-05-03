import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BASE_PARAMS, ERROR_CODES, listCategories } from "../catalog.js";

const TOPICS = [
  "overview",
  "workflow",
  "auth",
  "categories",
  "params",
  "errors",
  "examples",
] as const;
type Topic = (typeof TOPICS)[number];

function renderOverview(): string {
  const cats = listCategories();
  return [
    "# 지방재정365 OpenAPI MCP",
    "",
    "146개 지방재정 데이터셋을 통합 조회하는 MCP 서버입니다.",
    "출처: https://www.lofin365.go.kr (행정안전부)",
    "",
    "## 🚨 사용 원칙 — Two-Step Retrieval (반드시 지키세요)",
    "",
    "지방재정 데이터는 **지자체별로 사업명이 다르고, 연도별로 코드가 바뀝니다.**",
    "한 번에 정답을 추측해서 호출하면 환각·누락이 발생합니다.",
    "**항상 다음 2단계를 따르세요:**",
    "",
    "### 1단계 — 컨텍스트 탐색 (Context Discovery)",
    "데이터를 바로 가져오지 말고, **이 지자체·연도에서 찾으려는 정보가 어떤 코드/명칭으로 불리는지** 먼저 확인합니다.",
    "- 지역코드(`wa_laf_cd`)나 자치단체코드(`laf_cd`)를 모르면 → 가벼운 API(`JEDHI` 등)를 먼저 호출해 응답에서 추출",
    "- 분야/부문(`fld_nm`/`sect_nm`)이 모호하면 → `AIDFA`/`FDDDI` 응답에서 distinct 값 확인",
    "- 회계 종류(`acnt_dv_nm`)도 응답에서 실제 값 확인",
    "- **임의의 코드값을 만들어내지 마세요.** 한국 지방재정 데이터는 연도/지자체마다 분류가 다릅니다.",
    "",
    "### 2단계 — 타겟 데이터 조회 (Targeted Fetch)",
    "1단계에서 확정한 정확한 코드/명칭으로 본 데이터 API를 호출합니다.",
    "- `lofin_query` 호출 시 1단계에서 얻은 값만 사용",
    "- 모호한 자연어를 그대로 검색 인자로 넣지 말 것",
    "",
    "자세한 워크플로 예시: `lofin_guide({ topic: 'workflow' })`",
    "",
    "## 도구 3개",
    "- **lofin_guide**: 사용법 안내 (이 도구). topic으로 세부 가이드 호출",
    "- **lofin_search**: 카탈로그(146개 API)에서 서비스코드 검색",
    "- **lofin_query**: 데이터 조회 (서비스코드 + 검색 인자)",
    "",
    `## 카테고리 (${cats.length}개)`,
    cats.map((c) => `- ${c.category} (${c.count}개)`).join("\n"),
    "",
    "더 자세한 안내: `lofin_guide({ topic: 'workflow'|'auth'|'params'|'errors'|'examples'|'categories' })`",
  ].join("\n");
}

function renderWorkflow(): string {
  return [
    "# Two-Step Retrieval 워크플로",
    "",
    "지방재정 데이터의 이질성(지자체별 명명, 연도별 코드 변경) 때문에 **한 번에 정답을 호출하기 어렵습니다.**",
    "다음 패턴을 따르면 환각/누락을 크게 줄일 수 있습니다.",
    "",
    "## 일반 패턴",
    "",
    "```",
    "[사용자 요청 — 자연어 (예: \"세종 수자원 예산\")]",
    "        ↓",
    "  ① 의도 파싱: { 지역, 주제, 연도, 측면(예산/결산) }",
    "        ↓",
    "  ② lofin_search 로 카테고리/관련 API 후보 찾기",
    "        ↓",
    "  ③ 모르는 코드는 1차 호출로 확보",
    "       - 지역코드: JEDHI fyr=YYYY → 응답에서 wa_laf_hg_nm으로 매칭 → wa_laf_cd 추출",
    "       - 분야/부문: AIDFA fyr=YYYY+wa_laf_cd → 응답의 fld_nm/sect_nm 일람",
    "        ↓",
    "  ④ 2차 호출: 1차에서 확정한 코드만 사용",
    "        ↓",
    "  ⑤ 응답 필터/집계",
    "        ↓",
    "  ⑥ 메타 컨텍스트 첨부 (자치단체 유형, 분류 변경 등)",
    "```",
    "",
    "## 구체 예시 — \"2024년 세종 수자원 예산\"",
    "",
    "### ① 의도 파싱",
    "지역=\"세종\", 주제=\"수자원\", 연도=2024, 측면=예산",
    "",
    "### ② 카탈로그 탐색",
    "```",
    "lofin_search({ q: '수자원' })  // → 0건",
    "lofin_search({ q: '기능별' }) // → AIDFA, FDDDI 등 6건",
    "```",
    "→ 직접 매칭 없음 → 분야/부문 컬럼이 있는 AIDFA로 우회 결정",
    "",
    "### ③ 1차 호출 — 세종 wa_laf_cd 확보",
    "```",
    "lofin_query({ code: 'JEDHI', params: { fyr: 2024 }, pSize: 100 })",
    "→ rows에서 wa_laf_hg_nm='세종' 행 찾음",
    "→ wa_laf_cd = '3200000' 확정 (임의 X, 응답에서 추출)",
    "```",
    "",
    "### ④ 2차 호출 — 확정 코드로 본 데이터",
    "```",
    "lofin_query({",
    "  code: 'AIDFA',",
    "  params: { fyr: 2024, wa_laf_cd: '3200000' },",
    "  pSize: 200",
    "})",
    "```",
    "",
    "### ⑤ 응답 필터링",
    "rows 중 sect_nm 에 \"수자원\" 또는 \"상하수도\" 또는 \"수질\" 포함된 것 추출 → 4행",
    "",
    "### ⑥ 메타 컨텍스트",
    "- 세종은 광역+기초 통합 (특별자치시) → 자체 자치구 없음",
    "- 공기업특별회계가 큰 비중인 이유: 본청 직영 상수도사업본부",
    "- 2024년 분류 기준이며, 2018년 이전과 다를 수 있음",
    "",
    "## 절대 하지 말아야 할 것",
    "",
    "❌ `lofin_query({ code: 'AIDFA', params: { wa_laf_cd: '???' } })` — 코드 추측",
    "❌ `lofin_query({ code: 'AIDFA', params: { laf_hg_nm: '세종' } })` — 자치단체명 형식 가정",
    "   (`laf_hg_nm`은 '세종본청' 같은 광역+기초 결합형, 공식 명칭 미확인 시 검색 인자로 쓰지 말 것)",
    "❌ 한 API에서 0건 나왔다고 \"세종은 그 사업 없음\"이라 결론짓기",
    "   (다른 회계/분야에 분산되었거나, 본청 직영일 수 있음)",
    "",
    "## 출처 표기 (사용자 답변 시 필수)",
    "",
    "MCP 응답의 `source` 필드 한글명을 그대로 사용하세요. 서비스코드(`AIDFA`, `QWGJK` 등)는 내부 식별자라 사용자에게 의미 불명입니다.",
    "",
    "❌ 나쁜 예: \"출처: AIDFA, 2024년\"",
    "✅ 좋은 예: \"출처: 「구조별 기능별 세출예산」 (지방재정365), 2024년\"",
    "",
    "여러 API를 합친 답변일 때는 사용한 모든 데이터셋의 한글명을 명시하세요.",
    "",
    "## 시계열 분석 시 주의",
    "",
    "- 분야분류는 2014년 사업예산제도 도입 후 일부 부문 개편됨",
    "- 같은 fld_nm이라도 부문 구성이 다를 수 있음",
    "- 시계열 비교 시 항상 **응답의 실제 분류값**을 사용 (LLM 도메인 지식 추측 금지)",
  ].join("\n");
}

function renderAuth(): string {
  return [
    "# 인증키 발급",
    "",
    "1) https://lofin.mois.go.kr/portal/user/openApi.do 접속",
    "2) 회원가입 후 인증키 신청",
    "3) 환경변수 `LOFIN_API_KEY` 에 설정 (또는 `.env` 파일)",
    "",
    "한 개 키로 146개 API 모두 호출 가능. 일별 트래픽 제한 있음 (구체 수치 비공개).",
  ].join("\n");
}

function renderCategories(): string {
  const cats = listCategories();
  return [
    "# 카테고리 (개수 내림차순)",
    "",
    cats.map((c) => `- **${c.category}** (${c.count})`).join("\n"),
    "",
    "검색 예: `lofin_search({ category: '재정여건(예산)' })`",
  ].join("\n");
}

function renderParams(): string {
  return [
    "# 공통 파라미터",
    "",
    "모든 API는 다음 4개 기본 파라미터를 받습니다 (lofin_query가 자동 처리):",
    "",
    BASE_PARAMS.map((p) => `- **${p.name}** (${p.type}, ${p.required ? "필수" : "선택"}): ${p.description}${p.note ? ` — ${p.note}` : ""}`).join("\n"),
    "",
    "## 자주 쓰는 검색 파라미터 (API별로 다름, lofin_search 결과에서 확인)",
    "- **fyr** (회계연도, 145개 API): 예) 2024",
    "- **laf_cd** (자치단체코드, 71개 API): 예) 1100000 (서울본청)",
    "- **wa_laf_cd** (지역코드, 60개 API)",
    "- **laf_hg_nm** (자치단체명, 58개 API): 예) 서울종로구 (서울+종로구 형식)",
    "- **wa_laf_hg_nm** (지역명, 55개 API): 예) 서울",
    "",
    "⚠️ `laf_hg_nm`은 \"서울종로구\"처럼 광역+기초 결합형이며, \"종로구\"만으로는 검색되지 않습니다.",
  ].join("\n");
}

function renderErrors(): string {
  return [
    "# 결과 메시지 코드",
    "",
    "응답의 `RESULT.CODE` 필드 (형식: `INFO-XXX` / `ERROR-XXX`).",
    "",
    ERROR_CODES.map((e) => `- **${e.kind}-${e.code}**: ${e.message}`).join("\n"),
    "",
    "## 클라이언트 동작",
    "- **INFO-000**: 정상 데이터 반환",
    "- **INFO-200 (데이터 없음)**: 빈 배열 반환 (에러 아님)",
    "- **ERROR-290 (인증키 오류)**: 즉시 실패, 재시도 X",
    "- **ERROR-300 (필수값 누락)**: 즉시 실패, 재시도 X (lofin_query에서 사전 검증)",
    "- **ERROR-310 (잘못된 서비스코드)**: 즉시 실패",
    "- **ERROR-336/337 (한도 초과)**: 즉시 실패, 재시도 X",
    "- **ERROR-500/600/601 (서버/DB/SQL 오류)**: 자동 재시도 (최대 2회)",
  ].join("\n");
}

function renderExamples(): string {
  return [
    "# 사용 예시",
    "",
    "## 예시 1 — 재정자립도 검색 후 조회",
    "```",
    "1) lofin_search({ q: '재정자립도' })",
    "   → JFIED (재정자립도[최종]), DCFCE (재정자립도[당초]), FNCST (재정자립도[결산])",
    "",
    "2) lofin_query({",
    "     code: 'JFIED',",
    "     params: { fyr: 2024, laf_hg_nm: '서울종로구' }",
    "   })",
    "```",
    "",
    "## 예시 2 — 특정 카테고리만 보기",
    "```",
    "lofin_search({ category: '지방세', limit: 20 })",
    "```",
    "",
    "## 예시 3 — 페이지네이션",
    "```",
    "lofin_query({ code: 'JFIED', params: { fyr: 2024 }, pIndex: 2, pSize: 200 })",
    "// pSize 최대 1000",
    "```",
  ].join("\n");
}

const RENDERERS: Record<Topic, () => string> = {
  overview: renderOverview,
  workflow: renderWorkflow,
  auth: renderAuth,
  categories: renderCategories,
  params: renderParams,
  errors: renderErrors,
  examples: renderExamples,
};

export function registerGuideTool(server: McpServer): void {
  server.tool(
    "lofin_guide",
    "지방재정365 MCP 사용법 안내. 첫 호출 시 topic을 비워 overview를 받으세요. overview는 Two-Step Retrieval 사용 원칙을 포함합니다 — 데이터 조회 전 반드시 읽으세요. 세부 가이드는 topic으로 호출 (workflow/auth/categories/params/errors/examples).",
    {
      topic: z
        .enum(TOPICS)
        .optional()
        .describe("세부 주제. 미지정 시 'overview' 반환"),
    },
    async (args) => {
      const topic = (args.topic ?? "overview") as Topic;
      const text = RENDERERS[topic]();
      return { content: [{ type: "text", text }] };
    },
  );
}
