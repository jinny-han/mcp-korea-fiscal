# mcp-korea-fiscal

Unified MCP server providing LLM access to Korean public fiscal data — both **국가재정 (열린재정)** and **지방재정 (지방재정365)** through a single interface.

> 한국 공공 재정 데이터(**국가재정** + **지방재정**)를 LLM이 통합 조회할 수 있게 해주는 MCP 서버입니다. 열린재정과 지방재정365 두 OpenAPI를 하나의 MCP 인터페이스로 묶었습니다.

> **Status: v0.1.1.** Runtime-verified against both 열린재정 and 지방재정365 APIs.
> v0.1.1 — 두 API 모두 실제 호출 검증 완료.

---

## Why · 왜 만들었나

Researchers and policy analysts often need to query both **national** (`국가재정`) and **local-government** (`지방재정`) fiscal datasets side-by-side. Running two separate MCP servers for this is awkward; this project merges both behind one MCP so LLM-based analysis flows without context-switching between APIs.

> 재정 분석을 하다 보면 국가재정 + 지방재정을 같이 보는 일이 많은데, 두 MCP 서버를 따로 돌리는 건 번거롭습니다. 이 프로젝트는 두 데이터 소스를 하나의 MCP 안에 묶어서 LLM이 자유롭게 넘나들며 질의할 수 있게 합니다.

---

## Tools · 도구

Six tools, prefixed by domain · **6개 도구, 도메인별 접두사로 구분**:

### `kofin_*` — 국가재정 (열린재정 OpenAPI)

| Tool · 도구 | Purpose · 용도 |
|---|---|
| `kofin_guide` | Catalog overview (157 APIs across 6 categories) · 카탈로그 안내 (6개 카테고리, 157개 API) |
| `kofin_search` | Search APIs by keyword/category · 키워드·카테고리로 API 검색 |
| `kofin_query` | Fetch data given an API code · API 코드로 실제 데이터 조회 |

### `lofin_*` — 지방재정 (지방재정365 OpenAPI)

| Tool · 도구 | Purpose · 용도 |
|---|---|
| `lofin_guide` | Usage guide + Two-Step Retrieval pattern · 사용 안내 + Two-Step Retrieval 원칙 |
| `lofin_search` | Search the 146-dataset catalog · 146개 카탈로그 검색 |
| `lofin_query` | Fetch data given a service code · 서비스코드로 실제 데이터 조회 |

---

## Setup · 설치

### 1. Install · 설치

```bash
git clone https://github.com/jinny-han/mcp-korea-fiscal.git
cd mcp-korea-fiscal
npm install
npm run build
```

### 2. API keys · API 키 발급

Set **at least one** in `.env`. Tools for a subsystem only register if its key is set.
> **둘 중 최소 하나**는 `.env`에 설정해야 합니다. 키가 있는 쪽 도구만 활성화돼요.

| Variable | Required for | Get from · 발급처 |
|---|---|---|
| `OPENFISCAL_API_KEY` | `kofin_*` tools | [openfiscaldata.go.kr](https://openfiscaldata.go.kr) → 마이페이지 → OpenAPI 신청 |
| `LOFIN_API_KEY` | `lofin_*` tools | [지방재정365](https://www.lofin365.go.kr/portal/LF9220200.do) → 회원가입 → OpenAPI 인증키 신청. 문의: 행안부 지방재정365 ☎ 044-205-3739 / 02-2031-9621. 동일 데이터셋 일부는 [공공데이터포털](https://www.data.go.kr)에도 있지만 lofin 서비스코드 체계는 본 포털 키로만 사용 가능. |
| `DATAGOKR_API_KEY` | optional · 선택 (kofin 보조) | [data.go.kr](https://data.go.kr) |
| `NABOSTATS_API_KEY` | optional · 선택 (kofin 보조) | [nabo.go.kr](https://www.nabo.go.kr) |

```bash
cp .env.example .env
# edit .env — 발급받은 키 채우기
```

### 3. Claude Desktop config · Claude Desktop 설정

Add to `claude_desktop_config.json` · `claude_desktop_config.json`에 추가:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "korea-fiscal": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-korea-fiscal/dist/index.js"],
      "env": {
        "OPENFISCAL_API_KEY": "your_key_here",
        "LOFIN_API_KEY": "your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The six tools should activate.
> Claude Desktop 재시작하면 6개 도구가 활성화됩니다.

---

## Usage examples · 사용 예시

Once registered in Claude Desktop, ask in natural language. The LLM picks the right tools.
> Claude Desktop에 등록되면 자연어로 질문하시면 됩니다. LLM이 적절한 도구를 골라 호출해요.

```
2024년 국가채무 추이 보여줘
2024년 서울 종로구 재정자립도 알려줘
2024년 교육부 예산이 얼마야?
세종 수자원 관련 지방재정 항목들 정리해줘
```

---

## Project structure · 프로젝트 구조

```
src/
├── index.ts                 # entry — composes both subsystems via stdio
├── common/                  # shared resilience + cache + result-code (v0.1.1+)
│   ├── cache.ts             # createTtlCache (TTL + LRU)
│   ├── resilient-fetch.ts   # createResilientFetcher (retry + breaker + limit + dedup)
│   ├── result-code.ts       # classifyResultCode (INFO-XXX/ERROR-XXX → ok/empty/retryable)
│   └── index.ts             # barrel
├── kofin/                   # 국가재정 (열린재정) subsystem
│   ├── api/                 # client, catalog, xml-parser
│   ├── tools/               # kofin_guide, kofin_search, kofin_query
│   ├── prompts/
│   ├── config.ts
│   └── index.ts             # exports registerKofinTools()
└── lofin/                   # 지방재정 (지방재정365) subsystem
    ├── tools/               # lofin_guide, lofin_search, lofin_query
    ├── catalog.ts
    ├── client.ts
    └── index.ts             # exports registerLofinTools()
```

---

## Graceful key handling · 키 누락 처리

Top-level entry registers each subsystem in a `try/catch`. If `OPENFISCAL_API_KEY` is missing, the `kofin_*` tools are silently skipped (server still starts with `lofin_*`), and vice versa. If neither key is set, the server exits with a clear error.

> 한쪽 키만 있어도 그쪽 3개 도구는 정상 동작합니다. 다른 쪽은 자동으로 비활성화 (서버 fail 안 함). 둘 다 없으면 명확한 에러로 종료.

---

## Resilience · 신뢰성

Both subsystems share a common resilience layer (`src/common/resilient-fetch.ts`):

> 두 서브시스템이 공통 신뢰성 레이어를 공유합니다:

- **Retry** · 재시도 — Transient failures retried up to 2x (p-retry, exponential backoff). 네트워크/서버 오류 자동 재시도.
- **Circuit breaker** · 서킷 브레이커 — Trips at 50% failure rate after 5 calls; 30s reset (opossum). 연속 실패 시 30초간 차단.
- **Concurrency** · 동시성 제한 — Max 3 concurrent requests (p-limit). 일별 트래픽 한도 보호.
- **Inflight dedup** · 중복 요청 제거 — Identical concurrent calls share one promise. 같은 요청 동시 발생 시 한 번만 호출.
- **TTL+LRU cache** · 메모리 캐시 — Per-subsystem TTL with LRU eviction. 결과 캐싱 + 오래된 항목 자동 제거.

---

## Status & roadmap · 상태 및 향후 계획

**v0.1.1 (current · 현재)**:
- Runtime verified against both APIs · 두 API 실제 호출 검증 완료
- Common resilience layer extracted to `src/common/` · 공통 코드 추출
- 27 unit tests covering common modules · 공통 모듈 단위 테스트

**Planned · 계획**:
- Tool description audit (cross-reference fixes) · 툴 설명 cross-reference 정리
- npm publishing · npm 배포
- Smithery / awesome-mcp-servers registration · MCP 레지스트리 등록

---

## Authors & origin · 작성자 및 출처

This project is a unified merge of two predecessor MCPs. See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for full attribution.

> 두 개의 선행 MCP를 합친 프로젝트입니다. 상세 attribution은 [CONTRIBUTORS.md](./CONTRIBUTORS.md) 참고.

- **Project lead** · 기획·설계: [@jinny-han](https://github.com/jinny-han) (Haejin Han, [Korea Environment Institute](https://www.kei.re.kr))
- **Lead implementer** · 구현: [@yangheeseok1](https://github.com/yangheeseok1)

---

## License · 라이선스

MIT — see [LICENSE](./LICENSE).
