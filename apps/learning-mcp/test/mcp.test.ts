import assert from "node:assert/strict";
import test from "node:test";

import { connectCompiledStdioClient } from "@agent-tools/test-support/mcp-client.js";

test("compiled server exposes the learning control-loop surface", async () => {
  const client = await connectCompiledStdioClient("learning-mcp-test");
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["choose_interaction", "get_study", "record_learning_evidence", "request_hint", "start_study", "update_study"]);
    const chosen = await client.callTool({ name: "choose_interaction", arguments: { workflow: "work", mode: "coach", candidates: [{ type: "project-model", concept: "data-ownership", relevance: 1, consequence: 1 }] } });
    assert.equal((chosen.structuredContent as { decision: { concept?: string } }).decision.concept, "data-ownership");
  } finally {
    await client.close();
  }
});
