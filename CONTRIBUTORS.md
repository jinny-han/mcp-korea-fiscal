# Contributors

## Project lead & merge author · 기획·통합 작성자

- **[@jinny-han](https://github.com/jinny-han)** (Haejin Han, KEI) — Initiated the project, designed the merged architecture, and authored all v0.1.x work: top-level entry, the shared `src/common/` modules (cache, resilient-fetch, result-code), refactoring, tests, and documentation. Pair-programmed with Claude (Anthropic) as an AI assistant.

## Original implementer of predecessor MCPs · 선행 MCP 원저자

- **[@yangheeseok1](https://github.com/yangheeseok1)** (Heeseok Yang, KEI) — Original author and implementer of the two predecessor MCPs whose code lives in `src/kofin/` and `src/lofin/` (API client, catalog, response parsing, tools). Co-authored on commits that integrate his original work.

## Acknowledgments · 사사

This project merges code originally developed in two separate MCPs:

- [yangheeseok1/fiscal-api-mcp-](https://github.com/yangheeseok1/fiscal-api-mcp-) — 국가재정 (열린재정) MCP
- [yangheeseok1/lofin-api-mcp](https://github.com/yangheeseok1/lofin-api-mcp) — 지방재정 (지방재정365) MCP

Both predecessor projects are MIT-licensed. The merged codebase preserves their respective subsystems under `src/kofin/` and `src/lofin/`, with tool names re-prefixed (`kofin_*` / `lofin_*`) to coexist in a single MCP server.

The shared resilience/cache layer (`src/common/`), the integration plumbing (top-level entry, unified config), and all v0.1.x work (README, CLAUDE.md, plan documents, tests) are this project's own work under @jinny-han, with Claude as an AI pair-programming assistant.

> 두 선행 MCP는 인턴(@yangheeseok1)이 각각 만들었고, 이 repo의 **통합 작업 자체** (`src/common/`, top-level entry, README, 테스트, 문서 등)는 @jinny-han이 Claude를 AI 페어 프로그래머로 사용해 작성했습니다.
