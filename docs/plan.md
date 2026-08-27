# Plan

## Goal

Make the reusable parts of `opencode-workflow-guard` available to teams using different coding agents without overstating what MCP itself can enforce.

## Phase 1: portable policy core

- Define a versioned, client-neutral policy input and decision schema.
- Port high-value deterministic checks for protected paths, destructive operations, secret handling, Git safety, and external side effects.
- Keep policy evaluation pure: no shell execution and no action proxying in the policy engine.
- Add adversarial tests for quoting, wrappers, path traversal, symlinks, and compound commands as each policy is ported.

In progress: the shell-policy slice now covers the deterministic destructive-operation families, package hygiene checks, interactive terminal commands, and dynamic shell forms that prevent deterministic inspection. Next are symlink-aware protected/secret paths and protected-branch push parsing.

## Phase 2: client adapters

- Claude Code: provide a `PreToolUse` integration that turns policy decisions into host `allow`, `deny`, and `ask` outcomes.
- Codex: provide secure setup guidance and MCP tool configuration while relying on Codex's native sandbox and approvals for hard containment unless an official interception API becomes available.
- OpenCode: evaluate reusing the same portable policy core behind the existing plugin hooks.

## Phase 3: team policy

- Add project configuration with conservative defaults and auditable overrides.
- Support centrally managed policy over Streamable HTTP without sending secrets or raw file contents by default.
- Add structured audit events that record decisions and policy IDs without persisting sensitive command content.
- Define policy bundles for workstation, CI, infrastructure, and restricted production contexts.

## Phase 4: distribution and assurance

- Publish the npm package and provide pinned installation examples.
- Add client-specific black-box compatibility tests.
- Add threat-model documentation and a policy coverage matrix.
- Add release provenance, dependency review, and reproducible package-content checks.

## Non-goals

- Claiming an advisory MCP connection is a sandbox.
- Replacing OS/container isolation, least-privilege credentials, branch protection, or server-side authorization.
- Proxying every command through an MCP tool merely to create an illusion of enforcement.
