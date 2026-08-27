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

test("blocks destructive shell operations after shell normalization", () => {
  const destructive = [
    ["terra", "form -chdir=infra des", "troy"].join(""),
    ["kube", "ctl --namespace prod del", "ete deployment api"].join(""),
    ["git push origin main --", "force-with-lease"].join(""),
    ["docker system ", "prune"].join(""),
  ];

  for (const command of destructive) {
    assert.equal(checkPolicy({ action: "shell", command }).decision, "deny", command);
  }
});

test("blocks package hygiene violations", () => {
  const command = ["npm ", "publish"].join("");
  const result = checkPolicy({ action: "shell", command });
  assert.equal(result.decision, "deny");
  assert.equal(result.policy, "package-hygiene");
});

test("asks for interactive terminal commands instead of allowing a hang", () => {
  assert.equal(checkPolicy({ action: "shell", command: "vim README.md" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "env EDITOR=nano vim README.md" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "command less README.md" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "sudo ls" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "apt-get install jq" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "apt-get install -y jq" }).decision, "allow");
  assert.equal(checkPolicy({ action: "shell", command: "dnf install jq" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "dnf install -y jq" }).decision, "allow");
  assert.equal(checkPolicy({ action: "shell", command: "top" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "top -b -n 1" }).decision, "allow");
});

test("blocks destructive kubectl commands behind global options", () => {
  const verb = ["del", "ete"].join("");
  assert.equal(checkPolicy({ action: "shell", command: `kubectl --context prod ${verb} pod api` }).decision, "deny");
  assert.equal(checkPolicy({ action: "shell", command: `kubectl --context=prod --warnings-as-errors ${verb} pod api` }).decision, "deny");
  assert.equal(checkPolicy({ action: "shell", command: `env -S 'kubectl --context prod ${verb} pod api'` }).decision, "deny");
});

test("applies shell policies to later compound-command segments", () => {
  const verb = ["del", "ete"].join("");
  assert.equal(checkPolicy({ action: "shell", command: `printf ok && kubectl -n prod ${verb} pod api` }).decision, "deny");
});

test("blocks dynamic shell syntax that can hide policy-relevant commands", () => {
  const result = checkPolicy({ action: "shell", command: "sh " + "$" + "(printf command)" });
  assert.equal(result.decision, "deny");
  assert.equal(result.policy, "dynamic-shell-syntax");
  assert.equal(checkPolicy({ action: "shell", command: "g" + "$" + "{EMPTY}it push origin main --force" }).decision, "deny");
  assert.equal(checkPolicy({ action: "shell", command: "kub" + "$" + "EMPTY" + "ectl delete pod api" }).decision, "deny");
});

test("blocks destructive commands hidden by ANSI-C shell escapes", () => {
  const command = "$'g" + "\\x69" + "t' push origin main --force";
  assert.equal(checkPolicy({ action: "shell", command }).decision, "deny");
});

test("normalizes quoted terraform working directories", () => {
  const command = ["terraform -chdir 'infra dir' des", "troy"].join("");
  assert.equal(checkPolicy({ action: "shell", command }).decision, "deny");
});

test("detects pagers nested behind shell command wrappers", () => {
  assert.equal(checkPolicy({ action: "shell", command: "sh -c 'less README.md'" }).decision, "ask");
  assert.equal(checkPolicy({ action: "shell", command: "eval 'more README.md'" }).decision, "ask");
});
