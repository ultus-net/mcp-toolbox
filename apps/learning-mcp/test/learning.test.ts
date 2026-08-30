import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LearningStore, chooseInteraction } from "../src/learning.js";

const consequentialDesign = [{ type: "design" as const, concept: "authorization-boundary", relevance: 0.95, consequence: 0.95 }];

test("interaction modes preserve increasingly more learner reasoning", () => {
  assert.equal(chooseInteraction({ workflow: "work", mode: "coach", candidates: consequentialDesign, concepts: {} }).action, "question");
  assert.equal(chooseInteraction({ workflow: "work", mode: "interactive", candidates: [{ ...consequentialDesign[0]!, relevance: 0.55, consequence: 0.55 }], concepts: {} }).action, "question");
  assert.equal(chooseInteraction({ workflow: "work", mode: "coach", candidates: [{ ...consequentialDesign[0]!, relevance: 0.2, consequence: 0.2 }], concepts: {} }).action, "continue");
  assert.equal(chooseInteraction({ workflow: "work", mode: "step_by_step", candidates: [{ ...consequentialDesign[0]!, relevance: 0.2, consequence: 0.2 }], concepts: {} }).action, "question");
});

test("strong independent reasoning suppresses redundant coaching", () => {
  const concepts = { "authorization-boundary": { stage: "independent" as const, evidence: [], lastObservedAt: 1 } };
  assert.equal(chooseInteraction({ workflow: "work", mode: "coach", candidates: consequentialDesign, concepts }).action, "continue");
});

test("work oversight favors consequential project-model reasoning over routine work", () => {
  const decision = chooseInteraction({ workflow: "work", mode: "coach", concepts: {}, candidates: [
    { type: "new-concept", concept: "array-syntax", relevance: 0.2, consequence: 0.1 },
    { type: "project-model", concept: "write-ownership", relevance: 0.9, consequence: 1 },
  ] });
  assert.equal(decision.concept, "write-ownership");
  assert.equal(decision.action, "critique");
});

test("study state resumes source position and tracks progressive assistance", async () => {
  const root = await mkdtemp(join(tmpdir(), "learning-mcp-"));
  const path = join(root, "state.json");
  const store = new LearningStore(path);
  await store.startStudy({ source: "book:ostep", goal: "Understand concurrency", mode: "step_by_step", position: "chapter 26" });
  await store.setStudyInteraction("mutex-invariant");
  const firstHint = await store.requestHint();
  const secondHint = await store.requestHint();
  assert.equal(firstHint.assistanceLevel, 1);
  assert.equal(secondHint.assistanceLevel, 2);
  await store.updateStudy({ position: "chapter 27", activeConcepts: ["mutex-invariant"] });
  const resumed = await new LearningStore(path).getStudy();
  assert.equal(resumed?.position, "chapter 27");
  assert.equal(resumed?.assistanceLevel, 2);
  assert.deepEqual(resumed?.activeConcepts, ["mutex-invariant"]);
});

test("evidence is bounded and malformed persisted state fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "learning-mcp-"));
  const path = join(root, "state.json");
  const store = new LearningStore(path);
  for (let index = 0; index < 25; index++) {
    await store.recordEvidence({ concept: "race-condition", kind: "developing", summary: `attempt ${index}`, workflow: "work" });
  }
  assert.equal((await store.getProfile()).concepts["race-condition"]?.evidence.length, 20);
  await writeFile(path, "not-json", "utf8");
  assert.equal(Object.keys((await new LearningStore(path).getProfile()).concepts).length, 0);
  await writeFile(path, JSON.stringify({ version: 1, concepts: {}, study: { source: "book", assistanceLevel: "many" } }), "utf8");
  assert.equal(await new LearningStore(path).getStudy(), undefined);
});

test("study assistance survives repeated interaction selection for evidence provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "learning-mcp-"));
  const store = new LearningStore(join(root, "state.json"));
  await store.startStudy({ source: "book:ostep", goal: "Understand concurrency", mode: "coach", position: "chapter 26" });
  await store.setStudyInteraction("mutex-invariant");
  await store.requestHint();
  await store.setStudyInteraction("mutex-invariant");
  assert.equal(await store.currentAssistance("mutex-invariant"), 1);
});

test("special concept keys are treated as learner concepts, not object properties", async () => {
  const root = await mkdtemp(join(tmpdir(), "learning-mcp-"));
  const store = new LearningStore(join(root, "state.json"));
  const concept = await store.recordEvidence({ concept: "__proto__", kind: "developing", summary: "reasoned about object keys", workflow: "work" });
  assert.equal(concept.stage, "developing");
  const reloaded = new LearningStore(join(root, "state.json"));
  await reloaded.recordEvidence({ concept: "constructor", kind: "developing", summary: "reasoned after reload", workflow: "work" });
  assert.equal(Object.hasOwn((await reloaded.getProfile()).concepts, "constructor"), true);
});

test("study progress updates retain assistance until evidence can be recorded", async () => {
  const root = await mkdtemp(join(tmpdir(), "learning-mcp-"));
  const store = new LearningStore(join(root, "state.json"));
  await store.startStudy({ source: "book:ostep", goal: "Understand concurrency", mode: "coach", position: "chapter 26" });
  await store.setStudyInteraction("mutex-invariant");
  await store.requestHint();
  await store.updateStudy({ position: "chapter 27", activeConcepts: ["mutex-invariant"] });
  assert.equal(await store.currentAssistance("mutex-invariant"), 1);
});
