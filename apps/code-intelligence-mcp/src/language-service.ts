export interface SourcePosition {
  workspaceRoot: string;
  file: string;
  line: number;
  column: number;
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface SymbolQuery {
  workspaceRoot: string;
  file: string;
  limit: number;
}

export interface SourceSymbol extends SourceLocation {
  name: string;
  kind: string;
}

export interface SymbolResult {
  symbols: readonly SourceSymbol[];
  truncated: boolean;
}

export interface WorkspaceSymbolQuery {
  workspaceRoot: string;
  file?: string;
  query: string;
  limit: number;
}

export interface ReferenceQuery extends SourcePosition {
  limit: number;
}

export interface LocationResult {
  locations: readonly SourceLocation[];
  truncated: boolean;
}

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface SourceDiagnostic extends SourceLocation {
  severity: DiagnosticSeverity;
  code: number;
  message: string;
}

export interface DiagnosticResult {
  diagnostics: readonly SourceDiagnostic[];
  truncated: boolean;
}

export interface LanguageServiceAdapter {
  findDefinition(query: SourcePosition, signal?: AbortSignal): Promise<readonly SourceLocation[]>;
  documentSymbols(query: SymbolQuery, signal?: AbortSignal): Promise<SymbolResult>;
  workspaceSymbols(query: WorkspaceSymbolQuery, signal?: AbortSignal): Promise<SymbolResult>;
  findReferences(query: ReferenceQuery, signal?: AbortSignal): Promise<LocationResult>;
  diagnostics(query: SymbolQuery, signal?: AbortSignal): Promise<DiagnosticResult>;
  hover(query: HoverQuery, signal?: AbortSignal): Promise<HoverResult | undefined>;
  explainDiagnostic(input: { code: number; message: string }): DiagnosticExplanation;
  explainSymbol(query: SourcePosition, signal?: AbortSignal): Promise<SymbolExplanation | undefined>;
}

export interface HoverQuery extends SourcePosition {}

export interface HoverResult {
  displayString: string;
  documentation?: string;
  tags?: readonly { name: string; text?: string }[];
  location?: SourceLocation;
}

export type DiagnosticCategory =
  | "type_mismatch"
  | "null_safety"
  | "missing_property"
  | "scope_resolution"
  | "syntax"
  | "arity_mismatch"
  | "async_promise"
  | "general";

export interface DiagnosticExplanation {
  code: number;
  category: DiagnosticCategory;
  title: string;
  plainEnglishExplanation: string;
  underlyingPrinciple: string;
  guidingHints: readonly string[];
}

export interface SymbolExplanation {
  name: string;
  kind: string;
  displayString: string;
  documentation?: string;
  mentalModel: string;
  role: string;
  location?: SourceLocation;
}
