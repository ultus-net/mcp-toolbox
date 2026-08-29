# MCP Toolbox

A monorepo of focused Model Context Protocol (MCP) tools for software-engineering
agents. Each product owns a bounded capability and remains independently
publishable.

## Tools

- `workflow-guard-mcp` - portable workflow policy and enforcement decisions.
- `code-intelligence-mcp` - TypeScript definitions, references, symbols, and diagnostics.
- `test-intelligence-mcp` - test discovery, relevance, and bounded execution.
- `git-intelligence-mcp` - read-only local Git status, diff, and history evidence.
- `change-intelligence-mcp` - composed local change and verification evidence.
- `ci-intelligence-mcp` - read-only bounded CI run and job evidence.

Product documentation lives under `apps/<product>/README.md`. Architecture and
roadmap decisions live under `docs/architecture`, `PLAN.md`, and `ROADMAP.md`.

## Development

Requires Node.js 22+ and pnpm 11.5.2.

```sh
pnpm install
pnpm run verify
```
