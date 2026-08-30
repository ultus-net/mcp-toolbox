#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CANDIDATE_TYPES, EVIDENCE_KINDS, LearningStore, LEARNING_MODES, LEARNING_WORKFLOWS, chooseInteraction } from "./learning.js";

const server = new McpServer({ name: "learning-mcp", version: "0.1.0" });
const store = new LearningStore();
const mode = z.enum(LEARNING_MODES);
const workflow = z.enum(LEARNING_WORKFLOWS);
const candidate = z.object({ type: z.enum(CANDIDATE_TYPES), concept: z.string().min(1).max(100), relevance: z.number().min(0).max(1), consequence: z.number().min(0).max(1) });
const decision = z.object({ action: z.enum(["continue", "question", "prediction", "critique", "exercise", "explain", "read"]), concept: z.string().optional(), reason: z.string() });
const study = z.object({ source: z.string(), goal: z.string(), mode, position: z.string(), activeConcepts: z.array(z.string()), currentConcept: z.string().optional(), assistanceLevel: z.number(), updatedAt: z.number() });

server.registerTool("choose_interaction", {
  description: "Decide whether the next work or study step should preserve learner reasoning instead of being performed autonomously.",
  inputSchema: { workflow, mode, candidates: z.array(candidate).max(20) }, outputSchema: { decision },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
}, async (input) => {
  const profile = await store.getProfile();
  const result = chooseInteraction({ ...input, concepts: profile.concepts });
  if (input.workflow === "study" && result.action !== "continue" && result.concept) await store.setStudyInteraction(result.concept);
  const structuredContent = { decision: result };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
});

server.registerTool("record_learning_evidence", {
  description: "Record bounded evidence from reasoning the learner actually demonstrated; absence of evidence is not a deficit.",
  inputSchema: { concept: z.string().min(1).max(100), kind: z.enum(EVIDENCE_KINDS), summary: z.string().min(1).max(1000), workflow, context: z.string().max(500).optional() },
  outputSchema: { recorded: z.boolean() }, annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
}, async (input) => {
  const assistanceLevel = input.workflow === "study" ? await store.currentAssistance(input.concept) : undefined;
  if (input.kind === "independent" && assistanceLevel !== undefined && assistanceLevel > 0) throw new Error("Reasoning after study assistance cannot be recorded as independent.");
  await store.recordEvidence({ ...input, assistanceLevel });
  const structuredContent = { recorded: true };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
});

server.registerTool("start_study", {
  description: "Start or replace the active study session by reference to an external source; source content is not ingested.",
  inputSchema: { source: z.string().min(1).max(1000), goal: z.string().min(1).max(1000), mode, position: z.string().min(1).max(500) }, outputSchema: { study },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
}, async (input) => response("study", await store.startStudy(input)));

server.registerTool("get_study", {
  description: "Recover the active external-source study position and assistance state.", inputSchema: {}, outputSchema: { study: study.nullable() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
}, async () => response("study", (await store.getStudy()) ?? null));

server.registerTool("update_study", {
  description: "Advance the active study position after completing one meaningful learning step.",
  inputSchema: { position: z.string().min(1).max(500), activeConcepts: z.array(z.string().min(1).max(100)).max(20) }, outputSchema: { study },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
}, async (input) => response("study", await store.updateStudy(input)));

server.registerTool("request_hint", {
  description: "Advance progressive assistance for the current study interaction without supplying source content.", inputSchema: {}, outputSchema: { study },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
}, async () => response("study", await store.requestHint()));

function response(key: string, value: unknown) {
  const structuredContent = { [key]: value };
  return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }], structuredContent };
}

await server.connect(new StdioServerTransport());
