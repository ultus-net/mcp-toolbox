import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LEARNING_MODES = ["coach", "interactive", "step_by_step"] as const;
export const LEARNING_WORKFLOWS = ["work", "study"] as const;
export const EVIDENCE_KINDS = ["exposed", "developing", "demonstrated", "independent", "critique", "needs-reinforcement"] as const;
export const CANDIDATE_TYPES = ["design", "debugging", "new-concept", "project-model", "source-concept"] as const;

export type LearningMode = typeof LEARNING_MODES[number];
export type LearningWorkflow = typeof LEARNING_WORKFLOWS[number];
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
export type LearningStage = Exclude<EvidenceKind, "needs-reinforcement">;
export type CandidateType = typeof CANDIDATE_TYPES[number];
export type InteractionKind = "continue" | "question" | "prediction" | "critique" | "exercise" | "explain" | "read";

export interface Evidence {
  concept: string;
  kind: EvidenceKind;
  summary: string;
  workflow: LearningWorkflow;
  observedAt: number;
  context?: string;
  assistanceLevel?: number;
}

export interface LearnerConcept { stage: LearningStage; lastObservedAt: number; evidence: Evidence[] }
export interface LearnerProfile { concepts: Record<string, LearnerConcept> }
export interface LearningCandidate { type: CandidateType; concept: string; relevance: number; consequence: number }
export interface LearningDecision { action: InteractionKind; concept?: string; reason: string }

export interface StudySession {
  source: string;
  goal: string;
  mode: LearningMode;
  position: string;
  activeConcepts: string[];
  currentConcept?: string;
  assistanceLevel: number;
  updatedAt: number;
}

interface LearningState { version: 1; concepts: Record<string, LearnerConcept>; study?: StudySession }
const STAGES: LearningStage[] = ["exposed", "developing", "demonstrated", "independent", "critique"];
const MODE_THRESHOLD: Record<LearningMode, number> = { coach: 0.72, interactive: 0.42, step_by_step: 0 };

function ownConcept(concepts: Record<string, LearnerConcept>, name: string): LearnerConcept | undefined {
  return Object.prototype.hasOwnProperty.call(concepts, name) ? concepts[name] : undefined;
}

function mastery(concept: LearnerConcept | undefined): number {
  if (!concept) return 0;
  if (concept.evidence.at(-1)?.kind === "needs-reinforcement") return 0;
  return (STAGES.indexOf(concept.stage) + 1) / STAGES.length;
}

function actionFor(candidate: LearningCandidate, workflow: LearningWorkflow): InteractionKind {
  if (workflow === "study") return candidate.type === "source-concept" ? "question" : "exercise";
  if (candidate.type === "debugging") return "prediction";
  if (candidate.type === "project-model") return "critique";
  return "question";
}

export function chooseInteraction(input: { workflow: LearningWorkflow; mode: LearningMode; candidates: LearningCandidate[]; concepts: Record<string, LearnerConcept> }): LearningDecision {
  let selected: { candidate: LearningCandidate; score: number } | undefined;
  for (const candidate of input.candidates) {
    const known = ownConcept(input.concepts, candidate.concept);
    const knownMastery = mastery(known);
    if (input.mode === "coach" && knownMastery >= 0.8 && known?.evidence.at(-1)?.kind !== "needs-reinforcement") continue;
    const gap = 1 - knownMastery;
    const score = candidate.relevance * 0.4 + candidate.consequence * 0.4 + gap * 0.2;
    if (!selected || score > selected.score) selected = { candidate, score };
  }
  if (!selected || selected.score < MODE_THRESHOLD[input.mode]) return { action: "continue", reason: selected ? "No candidate warrants learner interruption in this mode." : "No learning opportunity was supplied." };
  return { action: actionFor(selected.candidate, input.workflow), concept: selected.candidate.concept, reason: "Preserve learner reasoning at the highest-value current opportunity." };
}

export function defaultDataPath(): string {
  const root = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(root, "learning-mcp", "state.json");
}

function emptyState(): LearningState { return { version: 1, concepts: Object.create(null) as Record<string, LearnerConcept> }; }

function validEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Partial<Evidence>;
  return typeof evidence.concept === "string" && evidence.concept.length >= 1 && evidence.concept.length <= 100 && EVIDENCE_KINDS.includes(evidence.kind as EvidenceKind) &&
    typeof evidence.summary === "string" && evidence.summary.length >= 1 && evidence.summary.length <= 1000 && LEARNING_WORKFLOWS.includes(evidence.workflow as LearningWorkflow) &&
    typeof evidence.observedAt === "number" && Number.isFinite(evidence.observedAt) && (evidence.context === undefined || (typeof evidence.context === "string" && evidence.context.length <= 500)) &&
    (evidence.assistanceLevel === undefined || (Number.isInteger(evidence.assistanceLevel) && evidence.assistanceLevel >= 0 && evidence.assistanceLevel <= 3));
}

function validStudy(value: unknown): value is StudySession {
  if (!value || typeof value !== "object") return false;
  const study = value as Partial<StudySession>;
  return typeof study.source === "string" && study.source.length >= 1 && study.source.length <= 1000 && typeof study.goal === "string" && study.goal.length >= 1 && study.goal.length <= 1000 &&
    LEARNING_MODES.includes(study.mode as LearningMode) && typeof study.position === "string" && study.position.length >= 1 && study.position.length <= 500 &&
    Array.isArray(study.activeConcepts) && study.activeConcepts.length <= 20 && study.activeConcepts.every((concept) => typeof concept === "string" && concept.length >= 1 && concept.length <= 100) &&
    (study.currentConcept === undefined || (typeof study.currentConcept === "string" && study.currentConcept.length >= 1 && study.currentConcept.length <= 100)) &&
    typeof study.assistanceLevel === "number" && Number.isInteger(study.assistanceLevel) && study.assistanceLevel >= 0 && study.assistanceLevel <= 3 && typeof study.updatedAt === "number" && Number.isFinite(study.updatedAt);
}

function validState(value: unknown): value is LearningState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<LearningState>;
  if (state.version !== 1 || !state.concepts || typeof state.concepts !== "object" || Array.isArray(state.concepts) || Object.keys(state.concepts).length > 500) return false;
  const conceptsValid = Object.entries(state.concepts).every(([name, concept]) => name.length >= 1 && name.length <= 100 && concept && typeof concept === "object" && STAGES.includes(concept.stage) && Number.isFinite(concept.lastObservedAt) && Array.isArray(concept.evidence) && concept.evidence.length <= 20 && concept.evidence.every(validEvidence));
  return conceptsValid && (state.study === undefined || validStudy(state.study));
}

export class LearningStore {
  constructor(private readonly path = defaultDataPath()) {}

  private async load(): Promise<LearningState> {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(content);
      if (!validState(parsed)) return emptyState();
      return { ...parsed, concepts: Object.assign(Object.create(null) as Record<string, LearnerConcept>, parsed.concepts) };
    } catch (error) {
      if (error instanceof SyntaxError) return emptyState();
      throw error;
    }
  }

  private async update(change: (state: LearningState) => void): Promise<LearningState> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock`;
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch { throw new Error("Learning state is busy; the update was not recorded."); }
    try {
      const state = await this.load();
      change(state);
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.path);
      return state;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  async getProfile(): Promise<LearnerProfile> { return { concepts: (await this.load()).concepts }; }

  async recordEvidence(input: Omit<Evidence, "observedAt">): Promise<LearnerConcept> {
    const state = await this.update((current) => {
      const existing = ownConcept(current.concepts, input.concept);
      if (!existing && Object.keys(current.concepts).length >= 500) throw new Error("Learner concept limit reached.");
      const evidence: Evidence = { ...input, observedAt: Date.now() };
      const proposed = input.kind === "needs-reinforcement" ? existing?.stage ?? "exposed" : input.kind;
      const stage = existing && STAGES.indexOf(existing.stage) > STAGES.indexOf(proposed) ? existing.stage : proposed;
      current.concepts[input.concept] = { stage, lastObservedAt: evidence.observedAt, evidence: [...(existing?.evidence ?? []), evidence].slice(-20) };
    });
    return state.concepts[input.concept]!;
  }

  async startStudy(input: { source: string; goal: string; mode: LearningMode; position: string }): Promise<StudySession> {
    const state = await this.update((current) => { current.study = { ...input, activeConcepts: [], assistanceLevel: 0, updatedAt: Date.now() }; });
    return state.study!;
  }

  async getStudy(): Promise<StudySession | undefined> { return (await this.load()).study; }

  async setStudyInteraction(concept: string): Promise<StudySession> {
    const state = await this.update((current) => {
      if (!current.study) throw new Error("No active study session.");
      if (current.study.currentConcept === concept) return;
      current.study.currentConcept = concept;
      current.study.assistanceLevel = 0;
      current.study.updatedAt = Date.now();
    });
    return state.study!;
  }

  async updateStudy(input: { position: string; activeConcepts: string[] }): Promise<StudySession> {
    const state = await this.update((current) => {
      if (!current.study) throw new Error("No active study session.");
      current.study.position = input.position;
      current.study.activeConcepts = input.activeConcepts;
      current.study.updatedAt = Date.now();
    });
    return state.study!;
  }

  async requestHint(): Promise<StudySession> {
    const state = await this.update((current) => {
      if (!current.study?.currentConcept) throw new Error("No active study interaction.");
      current.study.assistanceLevel = Math.min(current.study.assistanceLevel + 1, 3);
      current.study.updatedAt = Date.now();
    });
    return state.study!;
  }

  async currentAssistance(concept: string): Promise<number | undefined> {
    const study = (await this.load()).study;
    return study?.currentConcept === concept ? study.assistanceLevel : undefined;
  }
}
