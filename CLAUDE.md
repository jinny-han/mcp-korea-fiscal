# CLAUDE.md — Context for AI assistants

This file gives an AI coding assistant (Claude Code, etc.) the context needed to continue work on this repo across machines and sessions. Read this first.

## What this is

`mcp-korea-fiscal` — a unified Model Context Protocol server that exposes Korean public fiscal data through LLMs. Merges two predecessor MCPs into one:

- **국가재정 (열린재정 OpenAPI)** — `src/kofin/`, tools prefixed `kofin_*`
- **지방재정 (지방재정365 OpenAPI)** — `src/lofin/`, tools prefixed `lofin_*`

Both subsystems are self-contained and only register their tools if their respective API key is present.

## Predecessor repos (origin of substantive code)

- https://github.com/yangheeseok1/fiscal-api-mcp- — original 국가재정 MCP (note trailing hyphen in name)
- https://github.com/yangheeseok1/lofin-api-mcp — original 지방재정 MCP

Both MIT-licensed. Substantively all of `src/kofin/` and `src/lofin/` is the original implementer's work; this repo merges and renames tools to coexist. See [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## Conventions decided

- **Tool naming**: domain prefix + action — `kofin_search`, `kofin_query`, `kofin_guide`, `lofin_search`, `lofin_query`, `lofin_guide`. Six tools total. Do not rename without strong reason; users will pin to these.
- **Subsystem isolation**: each subsystem keeps its own response parsing, URL construction, and API key handling. Shared resilience (retry/breaker/concurrency/dedup), TTL+LRU cache, and result-code classification live in `src/common/` and are consumed via `../common/index.js` (or `../../common/index.js` from kofin's nested api/ dir).
- **Config style**: each subsystem loads its own env-based config. Top-level `src/index.ts` only orchestrates registration with try/catch graceful degradation per subsystem.
- **Language in user-facing text**: Korean primary, English where neutral. Code identifiers / file paths in English.
- **License**: MIT. Copyright preserved from predecessors.

## Repo structure

```
src/
├── index.ts                    # entry; composes both subsystems via stdio
├── common/                     # shared resilience + cache + result-code (since v0.1.1)
│   ├── cache.ts                # createTtlCache (TTL + LRU)
│   ├── resilient-fetch.ts      # createResilientFetcher (retry + breaker + limit + dedup)
│   ├── result-code.ts          # classifyResultCode (INFO-XXX / ERROR-XXX → ok/empty/retryable)
│   └── index.ts                # barrel
├── kofin/                      # 국가재정 (열린재정)
│   ├── api/                    # client, catalog, xml-parser (uses ../../common)
│   ├── tools/                  # kofin_guide, kofin_search, kofin_query
│   ├── prompts/templates.ts
│   ├── config.ts               # OPENFISCAL_API_KEY etc.
│   └── index.ts                # exports registerKofinTools(server)
└── lofin/                      # 지방재정 (지방재정365)
    ├── catalog.ts
    ├── client.ts               # reads LOFIN_API_KEY at request time (uses ../common)
    ├── tools/                  # lofin_guide, lofin_search, lofin_query
    ├── _workspace/             # catalog generation tooling (gen_catalog.py)
    └── index.ts                # exports registerLofinTools(server)
```

## Verified at v0.1.0

- `npm install` clean
- `npx tsc --noEmit` exits 0
- `npm run build` produces `dist/index.js` + dist/kofin + dist/lofin

Runtime against real APIs: not yet verified.

## Known follow-ups (next sessions)

These are **intentionally deferred** — do not silently expand scope. Pick one explicitly when working.

1. **`vitest.config.ts` unification** (~15 min)
   Currently no test runner config at top level. Each predecessor had its own vitest config. Merge or pick one and validate `npm test` runs cleanly.

2. ~~**Extract shared HTTP/error/cache logic to `src/common/`**~~ — done in v0.1.1. See `src/common/{cache,resilient-fetch,result-code}.ts` and tests under `tests/common/`. Both subsystems now go through `createResilientFetcher` and `createTtlCache`.

3. **Tool description cross-references audit**
   `sed` only renamed lowercase tool name strings (`fiscal_search` → `kofin_search` / `lofin_search`). Some help text or error hints may still reference old names in mixed contexts. Compile passes but UX may be confusing. Manual review pass.

4. **npm publish** — not done. Defer until v0.1.x is runtime-verified.

5. **Smithery / awesome-mcp-servers registration** — not done. Promotion concern, defer until quality bar set.

## Attribution model

The collaborator who originally implemented both predecessor MCPs (@yangheeseok1) is the lead implementer. The repo owner (@jinny-han) initiated the project, taught the methodology, and led the merge. Both names go in:

- README "Authors & origin" section
- CONTRIBUTORS.md
- Git commit metadata (owner as author, original implementer as Co-Authored-By trailer)

When making meaningful commits, preserve this — add `Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>` for any commit that touches the original-implementation code.

## How to resume on a fresh machine

```bash
git clone https://github.com/jinny-han/mcp-korea-fiscal.git
cd mcp-korea-fiscal
npm install
cp .env.example .env  # then fill in OPENFISCAL_API_KEY and/or LOFIN_API_KEY
npm run build
```

Then read this file + CONTRIBUTORS.md + README.md for full context. The two predecessor repos can be cloned for reference but should not be modified from here — they are the original implementer's personal work.
