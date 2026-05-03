# mcp-korea-fiscal

MCP server providing unified LLM access to Korean public fiscal data — both **국가재정** (national) and **지방재정** (local government).

## Status

Early development. Setting up project structure.

## Goal

Researchers and policy analysts often need to query both national and local-government fiscal datasets side-by-side. This MCP exposes both through a single interface so LLM-based analysis doesn't require context-switching between two separate APIs.

## Planned scope

- 국가재정 (열린재정) API integration
- 지방재정 (지방재정365) API integration
- Unified tool namespace
- Error normalization, pagination, key handling shared across both

## License

MIT
