import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPolicy } from "../src/policy.js";

test("blocks sensitive paths", () => {
  assert.equal(checkPolicy({ action: "file_write", path: "/etc/hosts" }).decision, "deny");
  assert.equal(checkPolicy({ action: "file_write", path: ".env" }).decision, "deny");
});

test("requires approval for external effects", () => {
  assert.equal(checkPolicy({ action: "network", command: "external request" }).decision, "ask");
});

test("allows an ordinary local action", () => {
  assert.equal(checkPolicy({ action: "file_write", path: "src/index.ts" }).decision, "allow");
});
