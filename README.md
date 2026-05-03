# mcp-korea-fiscal

Unified MCP server providing LLM access to Korean public fiscal data — both **국가재정 (열린재정)** and **지방재정 (지방재정365)** through a single interface.

> **Status: v0.1.0 — early.** Code merged from two predecessor MCPs. Compile/runtime verification pending.

## Why

Researchers and policy analysts often need to query both **national** (`국가재정`) and **local-government** (`지방재정`) fiscal datasets side-by-side. Running two separate MCP servers for this is awkward; this project merges both behind one MCP so LLM-based analysis flows without context-switching between APIs.

## Tools

Six tools, prefixed by domain:

### `kofin_*` — 국가재정 (열린재정 OpenAPI)

| Tool | Purpose |
|---|---|
| `kofin_guide` | Catalog overview (157 APIs across 6 categories) |
| `kofin_search` | Search APIs by keyword/category |
| `kofin_query` | Fetch data given an API code |

### `lofin_*` — 지방재정 (지방재정365 OpenAPI)

| Tool | Purpose |
|---|---|
| `lofin_guide` | Usage guide + Two-Step Retrieval pattern |
| `lofin_search` | Search the 146-dataset catalog |
| `lofin_query` | Fetch data given a service code |

## Setup

### 1. Install

```bash
git clone https://github.com/jinny-han/mcp-korea-fiscal.git
cd mcp-korea-fiscal
npm install
npm run build
```

### 2. Get API keys

Set **at least one** in `.env` (a subsystem's tools register only if its key is set).

| Variable | Required for | Get from |
|---|---|---|
| `OPENFISCAL_API_KEY` | `kofin_*` tools | [openfiscaldata.go.kr](https://openfiscaldata.go.kr) → 마이페이지 → OpenAPI 신청 |
| `LOFIN_API_KEY` | `lofin_*` tools | [lofin.mois.go.kr/portal/user/openApi.do](https://lofin.mois.go.kr/portal/user/openApi.do) |
| `DATAGOKR_API_KEY` | (optional, kofin) | [data.go.kr](https://data.go.kr) |
| `NABOSTATS_API_KEY` | (optional, kofin) | [nabo.go.kr](https://www.nabo.go.kr) |

```bash
cp .env.example .env
# edit .env to fill in your keys
```

### 3. Claude Desktop config

Add to `claude_desktop_config.json`:

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

## Project structure

```
src/
├── index.ts          # entry — composes both subsystems via stdio
├── kofin/            # 국가재정 (열린재정) subsystem
│   ├── api/          # client, cache, catalog, xml-parser
│   ├── tools/        # kofin_guide, kofin_search, kofin_query
│   ├── prompts/
│   ├── config.ts
│   └── index.ts      # exports registerKofinTools()
└── lofin/            # 지방재정 (지방재정365) subsystem
    ├── tools/        # lofin_guide, lofin_search, lofin_query
    ├── catalog.ts
    ├── client.ts
    └── index.ts      # exports registerLofinTools()
```

## Graceful key handling

Top-level entry registers each subsystem in a `try/catch`. If `OPENFISCAL_API_KEY` is missing, the `kofin_*` tools are silently skipped (server still starts with `lofin_*`), and vice versa. If neither key is set, the server exits with a clear error.

## Status & roadmap

This is a **v0.1.0 first-pass merge**. Both subsystems retain their original implementation (with renamed tool names to avoid collision). Future work:

- TypeScript compile verification across the merged tree
- Test consolidation
- Shared HTTP client / error normalization extracted to `src/common/`
- npm publishing
- Smithery / awesome-mcp-servers registration

## Authors & origin

This project is a unified merge of two predecessor MCPs. See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for full attribution.

- **Project lead**: [@jinny-han](https://github.com/jinny-han) (Haejin Han, [Korea Environment Institute](https://www.kei.re.kr))
- **Lead implementer**: [@yangheeseok1](https://github.com/yangheeseok1)

## License

MIT — see [LICENSE](./LICENSE).
