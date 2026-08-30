# Learning MCP Contract

## Objective

The Learning MCP exists to preserve useful human reasoning while an agent performs increasingly autonomous work. Its primary product is a portable pedagogical control loop, not a transcript, quiz engine, or generic memory store.

The service decides when delegating the next piece of reasoning would reduce the learner's ability to understand, supervise, or steer the work. A host remains responsible for actually pausing its agent and waiting for the learner's response.

The same control loop supports two initial workflows:

- `work`: learn through real engineering work while retaining enough of the project model to supervise agents;
- `study`: work through an external source such as a textbook, paper, course, or documentation set one meaningful interaction at a time.

Interaction intensity is independent of workflow. A study session may be lightly coached or strictly step-by-step, and work may use occasional oversight checkpoints or frequent interactive collaboration.

## Product Boundary

The Learning MCP owns:

- ranking candidate moments where human reasoning has learning or oversight value;
- deciding whether the agent should continue or request a learner interaction;
- selecting the kind of interaction: Socratic question, prediction, critique, exercise, explanation, or bounded reading step;
- adapting those decisions using evidence of reasoning the learner actually demonstrated;
- small person-scoped state needed by that control loop;
- source identity and progress needed to resume an active study session.

The Learning MCP does not own:

- host interruption, turn-taking, or enforcement;
- repository/project facts, which belong to Project Memory or authoritative repository sources;
- textbook/PDF contents, retrieval, indexing, or copyright-sensitive document storage;
- agent transcripts;
- correctness claims about a repository merely because the learner stated them;
- numeric grades or inferred deficits based on absence of evidence.

This differs from the earlier Socratic Learning candidate in `docs/research/product-boundaries.md`: durable history is supporting state, not the product center. The portable behavior that must survive a host change is the intervention/teaching decision.

## Modes And Workflows

`workflow` describes what the learner is doing:

- `work`: preserve technical and project oversight during real agent work;
- `study`: build understanding from an external source.

`mode` describes how much reasoning the agent may perform without learner participation:

- `coach`: normally continue autonomously; intervene only at high-value moments;
- `interactive`: ask the learner to reason through consequential decisions and important unfamiliar concepts;
- `step_by_step`: return at most one meaningful learner interaction before advancing.

Mode is behavioral rather than a persona. `step_by_step` therefore changes the control-loop result even when an agent would otherwise be capable of finishing the task autonomously.

## Evidence Model

The learner model records demonstrated reasoning rather than content exposure. Evidence is append-only and bounded per concept.

Evidence kinds are:

- `exposed`: the concept was introduced; this is weak evidence of understanding;
- `developing`: the learner reasoned about it with material assistance;
- `demonstrated`: the learner gave a sound explanation or application;
- `independent`: the learner predicted, designed, debugged, or solved before being given the reasoning;
- `critique`: the learner successfully evaluated or corrected another proposed reasoning path;
- `needs-reinforcement`: an observed interaction exposed a concrete misunderstanding or inability to apply the concept.

The service must not convert silence, an unseen concept, or a model-generated explanation into `needs-reinforcement`. Seeing or reading an explanation must not by itself establish `demonstrated` understanding.

Evidence may identify its workflow and project/source context. Project-scoped evidence describes the learner's reasoning about that project; it is not promoted to Project Memory and is not proof that the reasoning was factually correct unless separately verified.

## Oversight Semantics

For `work`, the control loop prioritizes moments that preserve the learner's ability to steer an autonomous agent:

- consequential architecture or boundary decisions;
- debugging hypotheses where prediction before observation is valuable;
- changes to important invariants or security/reliability behavior;
- project-model decisions whose rationale the learner needs in order to supervise future changes;
- critique of an agent proposal where recognizing a bad direction matters more than performing routine execution.

Routine syntax, mechanical edits, already-demonstrated concepts, and low-consequence implementation details should normally produce `continue`.

Candidate opportunities carry `relevance` and `consequence` in `[0, 1]`. The engine combines these with demonstrated mastery and mode. It returns a decision and rationale rather than silently causing an interruption.

## Study Semantics

A study session stores only a source reference supplied by the caller, a learner-visible goal, current source position, mode, active concepts, and interaction state. The caller remains responsible for reading the actual source and for supplying enough bounded context to make the next pedagogical decision.

Source references are descriptive identifiers or paths/URLs; creating a study session does not ingest or copy the source.

The study loop may request one of:

- `read`: consume a bounded source section before continuing;
- `question`: explain or reason about the important idea without first receiving the answer;
- `exercise`: apply the idea to a fresh bounded problem;
- `explain`: receive a targeted explanation when explanation is pedagogically preferable to testing;
- `continue`: no learner interaction is needed before the caller advances.

Hints are progressive assistance. Requesting a hint changes the assistance level recorded for the current interaction so later evidence can distinguish independent reasoning from reasoning produced after help.

## Initial Domain Contract

The first vertical slice should expose a small typed domain API beneath MCP transport:

```ts
type LearningWorkflow = "work" | "study";
type LearningMode = "coach" | "interactive" | "step_by_step";
type InteractionKind = "continue" | "question" | "prediction" | "critique" | "exercise" | "explain" | "read";

interface LearningCandidate {
  type: "design" | "debugging" | "new-concept" | "project-model" | "source-concept";
  concept: string;
  relevance: number;
  consequence: number;
}

interface LearningDecision {
  action: InteractionKind;
  concept?: string;
  reason: string;
}
```

Initial MCP tools should remain capability-oriented rather than mirror storage operations:

- `choose_interaction`: choose whether and how the learner should participate in the next real work/study step;
- `record_learning_evidence`: provide observed reasoning evidence after an interaction;
- `start_study`: create or replace an explicit active study session referencing an external source;
- `get_study`: recover current study position and interaction state;
- `update_study`: advance the source position/concepts after the learner and caller complete a step;
- `request_hint`: advance assistance for the active study interaction without revealing source content itself.

The existing OpenCode `learning_checkpoint` can later become a host adapter over `choose_interaction`. Its intervention budget and actual ask/wait orchestration remain host behavior unless cross-host dogfooding demonstrates that a portable session budget materially improves the decision engine.

## Persistence And Privacy

Persist locally by default under the user's data directory, not inside repositories. Learner state is person-scoped and must not be committed as project knowledge automatically.

Persistence is intentionally bounded:

- at most 500 concepts;
- at most 20 evidence records per concept;
- one active study session in the first vertical slice;
- bounded strings at every MCP input boundary;
- atomic local writes with user-only file permissions.

No remote synchronization is part of the initial contract. Cross-machine history is explicitly less important than preserving the control-loop behavior across clients.

## Failure Semantics

Malformed persisted state fails to a safe empty learner state rather than being partially trusted. A malformed study session is reported as unavailable rather than guessed from transcript context.

Write contention must fail explicitly; evidence must not be silently dropped. MCP validation rejects invalid modes, workflows, evidence kinds, scores, positions, and oversized text at the boundary.

The service is advisory. A host that ignores a `question` or `exercise` decision can still run ahead; MCP does not provide enforcement authority over host-native tools.

## Initial Success Criteria

The first implementation is successful when:

1. The same `choose_interaction` domain behavior can be exercised without OpenCode and through the compiled MCP server.
2. `coach`, `interactive`, and `step_by_step` produce observably different intervention behavior for deterministic fixtures.
3. Strong demonstrated/independent evidence reduces redundant interventions, while absence of evidence is never treated as failure.
4. A work fixture selects a consequential project-model/design checkpoint while ignoring a routine low-consequence candidate.
5. A study fixture can start at a source position, choose one next interaction, request progressive assistance, update progress, restart the process, and recover the position without storing the source content.
6. Evidence captured after hints cannot be represented as independent evidence without the caller explicitly making a false claim; the returned study state exposes assistance used so a host can record accurate provenance.
7. Domain, compiled stdio MCP, and packed-artifact tests pass without OpenCode or another harness-specific dependency.

## Deferred

- curricula, spaced-repetition scheduling, and numeric mastery scores;
- multiple simultaneous study sessions;
- document ingestion, embeddings, or RAG;
- remote learner-profile synchronization;
- automatic migration of the existing Workflow Guard learner profile;
- mandatory host enforcement protocols;
- dashboards, grading, achievements, or gamification.

These should be added only if dogfooding shows that they improve retained reasoning or steering ability rather than merely increasing recorded learning activity.
