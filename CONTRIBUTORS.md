# Contributors

## Project lead

- **[@jinny-han](https://github.com/jinny-han)** (Haejin Han, KEI) — Project initiation, design, and methodology.

## Lead implementer

- **[@yangheeseok1](https://github.com/yangheeseok1)** — Original implementations of the two predecessor MCPs (`fiscal-api-mcp-` and `lofin-api-mcp`) merged into this project.

## Acknowledgments

This project merges and unifies code originally developed in:
- [yangheeseok1/fiscal-api-mcp-](https://github.com/yangheeseok1/fiscal-api-mcp-) — 국가재정 (열린재정) MCP
- [yangheeseok1/lofin-api-mcp](https://github.com/yangheeseok1/lofin-api-mcp) — 지방재정 (지방재정365) MCP

Both predecessor projects are MIT-licensed. The merged codebase preserves their respective subsystems under `src/kofin/` and `src/lofin/`, with tool names re-prefixed (`kofin_*` / `lofin_*`) to coexist in a single MCP server.
