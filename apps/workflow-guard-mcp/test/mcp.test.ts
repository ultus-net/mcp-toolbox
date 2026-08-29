import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectCompiledStdioClient } from "../../../packages/test-support/mcp-client.ts";

let client: Client;

before(async () => {
  client = await connectCompiledStdioClient("workflow-guard-black-box-test");
});

after(async () => {
  await client.close();
});

test("initializes the compiled stdio server and discovers its tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["guard_check", "guard_status"],
  );
  assert.ok(tools.find((tool) => tool.name === "guard_check")?.outputSchema);
});

test("returns structured allow and deny policy decisions", async () => {
  const allowed = await client.callTool({
    name: "guard_check",
    arguments: { action: "shell", command: "git status" },
  });
  assert.equal(allowed.isError, undefined);
  assert.deepEqual(allowed.structuredContent, {
    decision: "allow",
    policy: "baseline",
    reason: "No baseline high-risk policy matched the proposed action.",
  });

  const denied = await client.callTool({
    name: "guard_check",
    arguments: { action: "file_write", path: ".env" },
  });
  assert.equal(denied.isError, undefined);
  assert.deepEqual(denied.structuredContent, {
    decision: "deny",
    policy: "protected-path",
    reason: "secret credential path",
  });
});

test("reports advisory status through the public tool", async () => {
  const result = await client.callTool({ name: "guard_status", arguments: {} });
  assert.deepEqual(result.content, [{
    type: "text",
    text: JSON.stringify({ mode: "policy-advisor", enforcement: "host-dependent", executesActions: false }),
  }]);
});

test("rejects malformed guard_check input at the MCP boundary", async () => {
  const result = await client.callTool({
    name: "guard_check",
    arguments: { action: "not-a-guard-action" },
  });
  assert.equal(result.isError, true);
});
