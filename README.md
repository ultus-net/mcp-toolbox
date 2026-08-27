# workflow-guard-mcp

Portable guardrails for agentic coding clients that speak the Model Context Protocol (MCP).

The project is intended to reduce the blast radius of fast, highly autonomous coding workflows by giving clients a shared policy decision point. The MCP server does not execute the proposed action itself.

## Status

This repository is an early port. The current `guard_check` tool implements the first deterministic policies from `opencode-workflow-guard`; it is not yet a complete port.

Most importantly, connecting an MCP server does not make it an interceptor for every native tool a coding client can execute. Hard enforcement depends on integration support in the host. See [Compatibility](docs/compatibility.md) and [Plan](docs/plan.md).

## Tools

- `guard_check`: evaluates a proposed `shell`, `file_write`, `git`, or `network` action and returns `allow`, `deny`, or `ask` with a machine-readable policy ID.
- `guard_status`: reports the server's current enforcement mode. It explicitly identifies this scaffold as host-dependent policy advice.

The portable shell policies cover the deterministic destructive-operation families from `opencode-workflow-guard`, selected unsafe package-management operations, interactive commands that can hang agent sessions, and denial of command/process substitution or ambiguous shell syntax that prevents deterministic inspection.

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm test
npm run typecheck
npm run build
```

The initial transport is stdio because both Claude Code and Codex support local stdio MCP servers. Streamable HTTP can be added without changing the policy API.

## Design Principle

The public promise is deliberately narrower than "this MCP sandboxes your coding agent." It centralizes policy. Client adapters enforce that policy wherever the client exposes a trustworthy interception mechanism; otherwise the result remains advisory and should be combined with the client's native sandbox and approval controls.

## Sources

The compatibility design was checked against current official documentation and source on 2026-08-27:

- Anthropic Claude Code MCP: https://docs.claude.com/en/docs/claude-code/mcp
- Anthropic Claude Code hooks: https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md
- OpenAI Codex: https://github.com/openai/codex
- Codex MCP configuration implementation: https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/server.md

## License

MIT
