import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import ts from "typescript";

import type {
  DiagnosticCategory,
  DiagnosticExplanation,
  DiagnosticResult,
  DiagnosticSeverity,
  HoverQuery,
  HoverResult,
  LanguageServiceAdapter,
  LocationResult,
  ReferenceQuery,
  SourceLocation,
  SourcePosition,
  SourceSymbol,
  SymbolExplanation,
  SymbolQuery,
  SymbolResult,
  WorkspaceSymbolQuery,
} from "./language-service.js";

function diagnosticSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error: return "error";
    case ts.DiagnosticCategory.Warning: return "warning";
    case ts.DiagnosticCategory.Suggestion: return "hint";
    default: return "information";
  }
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isDependencyPath(root: string, target: string): boolean {
  return relative(root, target).split(/[\\/]/).includes("node_modules");
}

function realPathWithin(root: string, target: string): boolean {
  try {
    return isWithin(realpathSync(root), realpathSync(target));
  } catch {
    return false;
  }
}

function findConfigPath(workspaceRoot: string, fileName: string): string | undefined {
  let directory = dirname(fileName);
  while (isWithin(workspaceRoot, directory)) {
    const candidate = resolve(directory, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    if (directory === workspaceRoot) break;
    directory = dirname(directory);
  }
  return undefined;
}

export class TypeScriptLanguageService implements LanguageServiceAdapter {
  async diagnostics(query: SymbolQuery, signal?: AbortSignal): Promise<DiagnosticResult> {
    const { service, fileName, workspaceRoot, dispose } = this.openProject(query, signal);
    try {
      abortIfRequested(signal);
      const diagnostics = [
        ...service.getSyntacticDiagnostics(fileName),
        ...service.getSemanticDiagnostics(fileName),
      ];
      abortIfRequested(signal);
      const byDiagnostic = new Map<string, DiagnosticResult["diagnostics"][number]>();
      for (const diagnostic of diagnostics) {
        abortIfRequested(signal);
        if (!diagnostic.file || diagnostic.start === undefined || diagnostic.length === undefined) continue;
        const diagnosticFile = resolve(diagnostic.file.fileName);
        if (!isWithin(workspaceRoot, diagnosticFile) || isDependencyPath(workspaceRoot, diagnosticFile)) continue;
        const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const end = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length);
        const normalized = {
          severity: diagnosticSeverity(diagnostic.category),
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          file: relative(workspaceRoot, diagnosticFile).replaceAll("\\", "/"),
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
        } as const;
        byDiagnostic.set(`${normalized.file}:${diagnostic.start}:${diagnostic.length}:${normalized.severity}:${normalized.code}:${normalized.message}`, normalized);
      }
      const normalized = [...byDiagnostic.values()];
      normalized.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) || left.line - right.line || left.column - right.column || left.endLine - right.endLine || left.endColumn - right.endColumn || left.severity.localeCompare(right.severity) || left.code - right.code || left.message.localeCompare(right.message));
      return { diagnostics: normalized.slice(0, query.limit), truncated: normalized.length > query.limit };
    } finally {
      dispose();
    }
  }

  async findReferences(query: ReferenceQuery, signal?: AbortSignal): Promise<LocationResult> {
    const { service, fileName, workspaceRoot, dispose } = this.openProject(query, signal);
    try {
      const sourceFile = service.getProgram()?.getSourceFile(fileName);
      if (!sourceFile) throw new Error(`Source file is not part of the TypeScript project: ${query.file}`);
      const lineStarts = sourceFile.getLineStarts();
      if (query.line > lineStarts.length) throw new Error("Source position is outside the file");
      const lineStart = lineStarts[query.line - 1]!;
      const lineEnd = sourceFile.getLineEndOfPosition(lineStart);
      if (query.column - 1 > lineEnd - lineStart) throw new Error("Source position is outside the file");

      const position = sourceFile.getPositionOfLineAndCharacter(query.line - 1, query.column - 1);
      abortIfRequested(signal);
      const references = service.getReferencesAtPosition(fileName, position) ?? [];
      abortIfRequested(signal);
      const locations: SourceLocation[] = [];
      for (const reference of references) {
        abortIfRequested(signal);
        const referenceFile = resolve(reference.fileName);
        if (!isWithin(workspaceRoot, referenceFile) || isDependencyPath(workspaceRoot, referenceFile)) continue;
        const target = service.getProgram()?.getSourceFile(reference.fileName);
        if (!target) continue;
        const start = target.getLineAndCharacterOfPosition(reference.textSpan.start);
        const end = target.getLineAndCharacterOfPosition(reference.textSpan.start + reference.textSpan.length);
        locations.push({
          file: relative(workspaceRoot, referenceFile).replaceAll("\\", "/"),
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
        });
      }
      locations.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) || left.line - right.line || left.column - right.column || left.endLine - right.endLine || left.endColumn - right.endColumn);
      return { locations: locations.slice(0, query.limit), truncated: locations.length > query.limit };
    } finally {
      dispose();
    }
  }

  async workspaceSymbols(query: WorkspaceSymbolQuery, signal?: AbortSignal): Promise<SymbolResult> {
    abortIfRequested(signal);
    const workspaceRoot = resolve(query.workspaceRoot);
    const projectSources = query.file ? [query.file] : this.projectSources(workspaceRoot);
    const byLocation = new Map<string, SourceSymbol>();
    for (const file of projectSources) {
      const { service, dispose } = this.openProject({ workspaceRoot, file }, signal);
      try {
        abortIfRequested(signal);
        const items = service.getNavigateToItems(query.query, undefined, undefined, true, true);
        for (const item of items) {
          abortIfRequested(signal);
          const itemFile = resolve(item.fileName);
          if (!isWithin(workspaceRoot, itemFile) || isDependencyPath(workspaceRoot, itemFile)) continue;
          const sourceFile = service.getProgram()?.getSourceFile(item.fileName);
          if (!sourceFile) continue;
          const start = sourceFile.getLineAndCharacterOfPosition(item.textSpan.start);
          const end = sourceFile.getLineAndCharacterOfPosition(item.textSpan.start + item.textSpan.length);
          const symbol: SourceSymbol = {
            name: item.name,
            kind: item.kind,
            file: relative(workspaceRoot, itemFile).replaceAll("\\", "/"),
            line: start.line + 1,
            column: start.character + 1,
            endLine: end.line + 1,
            endColumn: end.character + 1,
          };
          byLocation.set(`${symbol.file}:${item.textSpan.start}:${item.textSpan.length}:${symbol.name}:${symbol.kind}`, symbol);
        }
      } finally {
        dispose();
      }
    }
    const symbols = [...byLocation.values()];
    symbols.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column || left.name.localeCompare(right.name));
    return { symbols: symbols.slice(0, query.limit), truncated: symbols.length > query.limit };
  }

  async documentSymbols(query: SymbolQuery, signal?: AbortSignal): Promise<SymbolResult> {
    const { service, fileName, workspaceRoot, dispose } = this.openProject(query, signal);
    try {
      const sourceFile = service.getProgram()?.getSourceFile(fileName);
      if (!sourceFile) throw new Error(`Source file is not part of the TypeScript project: ${query.file}`);
      const tree = service.getNavigationTree(fileName);
      const symbols: Array<SourceSymbol & { position: number }> = [];

      const visit = (items: readonly ts.NavigationTree[]): void => {
        for (const item of items) {
          abortIfRequested(signal);
          if (item.spans[0] && item.kind !== ts.ScriptElementKind.moduleElement) {
            const span = item.spans[0];
            const start = sourceFile.getLineAndCharacterOfPosition(span.start);
            const end = sourceFile.getLineAndCharacterOfPosition(span.start + span.length);
            symbols.push({
              name: item.text,
              kind: item.kind,
              file: relative(workspaceRoot, fileName).replaceAll("\\", "/"),
              line: start.line + 1,
              column: start.character + 1,
              endLine: end.line + 1,
              endColumn: end.character + 1,
              position: span.start,
            });
          }
          if (item.childItems) visit(item.childItems);
        }
      };

      visit(tree.childItems ?? []);
      symbols.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
      const truncated = symbols.length > query.limit;
      return { symbols: symbols.slice(0, query.limit).map(({ position: _position, ...symbol }) => symbol), truncated };
    } finally {
      dispose();
    }
  }

  async findDefinition(query: SourcePosition, signal?: AbortSignal): Promise<readonly SourceLocation[]> {
    const { service, fileName, workspaceRoot, dispose } = this.openProject(query, signal);
    try {
      const sourceFile = service.getProgram()?.getSourceFile(fileName);
      if (!sourceFile) throw new Error(`Source file is not part of the TypeScript project: ${query.file}`);
      const lineStarts = sourceFile.getLineStarts();
      if (query.line > lineStarts.length) throw new Error("Source position is outside the file");
      const lineStart = lineStarts[query.line - 1]!;
      const lineEnd = sourceFile.getLineEndOfPosition(lineStart);
      if (query.column - 1 > lineEnd - lineStart) throw new Error("Source position is outside the file");

      const position = sourceFile.getPositionOfLineAndCharacter(query.line - 1, query.column - 1);
      abortIfRequested(signal);
      const definitions = service.getDefinitionAtPosition(fileName, position) ?? [];
      abortIfRequested(signal);

      const locations: SourceLocation[] = [];
      for (const definition of definitions) {
        const definitionFile = resolve(definition.fileName);
        if (!isWithin(workspaceRoot, definitionFile) || isDependencyPath(workspaceRoot, definitionFile)) continue;
        const target = service.getProgram()?.getSourceFile(definition.fileName);
        if (!target) continue;
        const start = target.getLineAndCharacterOfPosition(definition.textSpan.start);
        const end = target.getLineAndCharacterOfPosition(definition.textSpan.start + definition.textSpan.length);
        locations.push({
          file: relative(workspaceRoot, definitionFile).replaceAll("\\", "/"),
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
        });
      }
      return locations;
    } finally {
      dispose();
    }
  }

  async hover(query: HoverQuery, signal?: AbortSignal): Promise<HoverResult | undefined> {
    const { service, fileName, workspaceRoot, dispose } = this.openProject(query, signal);
    try {
      abortIfRequested(signal);
      const sourceFile = service.getProgram()?.getSourceFile(fileName);
      if (!sourceFile) return undefined;
      const position = sourceFile.getPositionOfLineAndCharacter(query.line - 1, query.column - 1);
      const quickInfo = service.getQuickInfoAtPosition(fileName, position);
      if (!quickInfo) return undefined;

      const displayString = ts.displayPartsToString(quickInfo.displayParts);
      const documentation = ts.displayPartsToString(quickInfo.documentation);
      const tags = quickInfo.tags?.map((tag) => ({
        name: tag.name,
        text: tag.text ? ts.displayPartsToString(tag.text) : undefined,
      }));

      let location: SourceLocation | undefined;
      if (quickInfo.textSpan) {
        const start = sourceFile.getLineAndCharacterOfPosition(quickInfo.textSpan.start);
        const end = sourceFile.getLineAndCharacterOfPosition(quickInfo.textSpan.start + quickInfo.textSpan.length);
        location = {
          file: relative(workspaceRoot, fileName).replaceAll("\\", "/"),
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
        };
      }

      return {
        displayString,
        documentation: documentation.length > 0 ? documentation : undefined,
        tags: tags && tags.length > 0 ? tags : undefined,
        location,
      };
    } finally {
      dispose();
    }
  }

  explainDiagnostic(input: { code: number; message: string }): DiagnosticExplanation {
    const { code, message } = input;
    switch (code) {
      case 2322:
        return {
          code,
          category: "type_mismatch",
          title: "Type Assignment Incompatibility",
          plainEnglishExplanation: "You are trying to assign or return a value whose type does not match what the variable, property, or return signature expects.",
          underlyingPrinciple: "TypeScript enforces static typing so operations valid on one type are never accidentally performed on an incompatible type at runtime.",
          guidingHints: [
            "Compare the expected type with the actual type of the value being assigned.",
            "Consider mapping, converting, or casting the value to conform to the expected shape.",
            "Inspect if the receiving type definition should be widened (e.g., using a union type).",
          ],
        };
      case 2345:
        return {
          code,
          category: "type_mismatch",
          title: "Function Argument Type Mismatch",
          plainEnglishExplanation: "The argument provided in the function call does not match the parameter type declared by the function.",
          underlyingPrinciple: "Function signatures define caller contracts; passing an unexpected type risks runtime failures inside the function body.",
          guidingHints: [
            "Check the parameter type at this position in the function declaration.",
            "Ensure nullable or optional values are checked or narrowed before passing them in.",
            "Transform the argument into the required shape before calling the function.",
          ],
        };
      case 2339:
        return {
          code,
          category: "missing_property",
          title: "Property Not Found on Type",
          plainEnglishExplanation: "You are trying to access a property on an object, but TypeScript cannot verify that the property exists on that object's type.",
          underlyingPrinciple: "Accessing non-existent properties returns undefined in JavaScript, which often cascades into unexpected behavior or TypeError crashes.",
          guidingHints: [
            "Check the property name for spelling mistakes or casing discrepancies.",
            "Verify that the interface or type alias includes this property.",
            "If the object is a union, use a type guard (e.g. 'in' operator) to narrow to the variant containing the property.",
          ],
        };
      case 2531:
      case 2532:
      case 2533:
      case 18047:
      case 18048:
        return {
          code,
          category: "null_safety",
          title: "Possible Null or Undefined Access",
          plainEnglishExplanation: "You are attempting to access a property, call a method, or index into a value that might be null or undefined.",
          underlyingPrinciple: "In strict null checking mode, TypeScript protects against 'Cannot read properties of null/undefined' crashes, the most common source of JavaScript runtime errors.",
          guidingHints: [
            "Use optional chaining (?.) if the expression should safely evaluate to undefined when absent.",
            "Add a guard (e.g., if (value != null)) to narrow the type before accessing members.",
            "Provide a fallback default using the nullish coalescing operator (??).",
          ],
        };
      case 2304:
        return {
          code,
          category: "scope_resolution",
          title: "Undeclared Identifier (Cannot Find Name)",
          plainEnglishExplanation: "You referenced an identifier that is not declared in the current scope or imported into this file.",
          underlyingPrinciple: "Every identifier must be declared or imported so the compiler and runtime can resolve its memory binding.",
          guidingHints: [
            "Check the spelling of the variable, function, or type name.",
            "Ensure the necessary module or variable is imported at the top of the file.",
            "If this is a global variable from an external library, ensure its @types package is installed.",
          ],
        };
      case 2307:
        return {
          code,
          category: "scope_resolution",
          title: "Cannot Find Module or Type Declarations",
          plainEnglishExplanation: "TypeScript cannot find the file or package you are attempting to import.",
          underlyingPrinciple: "Imports must resolve to a valid local file path or installed package with type declarations.",
          guidingHints: [
            "Verify the relative file path or package name is spelled correctly.",
            "Ensure the package is in package.json and dependencies have been installed.",
            "Check if the package requires a separate @types/<package> declaration package.",
          ],
        };
      case 2554:
        return {
          code,
          category: "arity_mismatch",
          title: "Argument Count Mismatch",
          plainEnglishExplanation: "The function was called with a different number of arguments than its signature expects.",
          underlyingPrinciple: "Signatures define required vs. optional parameters; missing arguments receive undefined, which may violate internal assumptions.",
          guidingHints: [
            "Check how many required parameters the function accepts.",
            "Supply the missing arguments or make trailing parameters optional (?) in the function declaration.",
          ],
        };
      case 7006:
        return {
          code,
          category: "type_mismatch",
          title: "Implicit 'any' Parameter",
          plainEnglishExplanation: "A function parameter does not have an explicit type annotation and TypeScript cannot infer one from usage.",
          underlyingPrinciple: "When noImplicitAny is enabled, TypeScript requires explicit parameter types to prevent untyped code from bypassing type checks.",
          guidingHints: [
            "Add an explicit type annotation to the parameter (e.g., param: string).",
            "If this is a callback parameter, check if the parent function's generic signature needs refinement.",
          ],
        };
      case 1005:
      case 1109:
        return {
          code,
          category: "syntax",
          title: "Syntax Error",
          plainEnglishExplanation: "The compiler encountered code that violates JavaScript/TypeScript grammar rules.",
          underlyingPrinciple: "Valid syntax is required before the compiler can construct an Abstract Syntax Tree (AST) for semantic analysis.",
          guidingHints: [
            "Check for unmatched parentheses, brackets, or braces nearby.",
            "Look for missing commas, semicolons, or incomplete expressions on the preceding lines.",
          ],
        };
      default:
        return {
          code,
          category: "general",
          title: "TypeScript Diagnostic",
          plainEnglishExplanation: `The TypeScript compiler flagged an issue: ${message}`,
          underlyingPrinciple: "The static type system prevents code with structural or semantic inconsistencies from compiling.",
          guidingHints: [
            "Inspect the error location in source code and check the surrounding types.",
            "Consult TypeScript documentation or search the diagnostic code for standard resolution patterns.",
          ],
        };
    }
  }

  async explainSymbol(query: SourcePosition, signal?: AbortSignal): Promise<SymbolExplanation | undefined> {
    const { service, fileName, workspaceRoot, dispose } = this.openProject(query, signal);
    try {
      abortIfRequested(signal);
      const sourceFile = service.getProgram()?.getSourceFile(fileName);
      if (!sourceFile) return undefined;
      const position = sourceFile.getPositionOfLineAndCharacter(query.line - 1, query.column - 1);
      const quickInfo = service.getQuickInfoAtPosition(fileName, position);
      if (!quickInfo) return undefined;

      const displayString = ts.displayPartsToString(quickInfo.displayParts);
      const documentation = ts.displayPartsToString(quickInfo.documentation);
      const kind = quickInfo.kind ?? "unknown";

      let name = "";
      if (quickInfo.displayParts && quickInfo.displayParts.length > 0) {
        const namePart = quickInfo.displayParts.find((part) => part.kind === "text" || part.kind === "functionName" || part.kind === "propertyName" || part.kind === "interfaceName" || part.kind === "className" || part.kind === "aliasName") ?? quickInfo.displayParts[0];
        name = namePart?.text ?? "";
      }

      let role = "Semantic symbol";
      let mentalModel = "A declared symbol in the TypeScript AST.";

      if (kind === "function" || kind === "method" || kind === "local function") {
        role = "Callable routine";
        mentalModel = "A function that accepts inputs and produces a return value. In TypeScript, functions establish lexical scope and parameter type contracts.";
      } else if (kind === "interface" || kind === "type") {
        role = "Type contract";
        mentalModel = "A structural contract defining the expected shape of data. TypeScript uses structural subtyping, meaning any object satisfying this shape is valid.";
      } else if (kind === "class") {
        role = "Class construct";
        mentalModel = "An object blueprint that encapsulates state (properties) and behavior (methods). Instances created with 'new' share this structure.";
      } else if (kind === "property") {
        role = "Object property";
        mentalModel = "A named value member of an object structure or interface.";
      } else if (kind === "parameter") {
        role = "Function parameter";
        mentalModel = "An input argument provided by callers and bound to the function's local scope.";
      } else if (kind === "const" || kind === "let" || kind === "var" || kind === "local var") {
        role = "Variable binding";
        mentalModel = "A named reference bound to a value in the current lexical scope.";
      }

      let location: SourceLocation | undefined;
      if (quickInfo.textSpan) {
        const start = sourceFile.getLineAndCharacterOfPosition(quickInfo.textSpan.start);
        const end = sourceFile.getLineAndCharacterOfPosition(quickInfo.textSpan.start + quickInfo.textSpan.length);
        location = {
          file: relative(workspaceRoot, fileName).replaceAll("\\", "/"),
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
        };
      }

      return {
        name: name || "symbol",
        kind,
        displayString,
        documentation: documentation.length > 0 ? documentation : undefined,
        mentalModel,
        role,
        location,
      };
    } finally {
      dispose();
    }
  }

  private openProject(query: { workspaceRoot: string; file: string }, signal?: AbortSignal) {
    abortIfRequested(signal);
    const workspaceRoot = resolve(query.workspaceRoot);
    const fileName = resolve(workspaceRoot, query.file);
    if (!isWithin(workspaceRoot, fileName)) throw new Error("Source file is outside the workspace");
    if (!existsSync(fileName)) throw new Error(`Source file does not exist: ${query.file}`);
    if (!realPathWithin(workspaceRoot, fileName)) throw new Error("Source file resolves outside the workspace");

    const configPath = findConfigPath(workspaceRoot, fileName);
    if (!configPath || !realPathWithin(workspaceRoot, configPath)) {
      throw new Error(`No tsconfig.json found within workspace for ${query.file}`);
    }

    const configFile = ts.readConfigFile(configPath, (path) => readFileSync(path, "utf8"));
    if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    const compilerLibRoot = realpathSync(dirname(ts.getDefaultLibFilePath({})));
    const canRead = (path: string): boolean => realPathWithin(workspaceRoot, path) || realPathWithin(compilerLibRoot, path);
    const parseHost: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: (path) => canRead(path) && ts.sys.fileExists(path),
      readFile: (path) => canRead(path) ? ts.sys.readFile(path) : undefined,
      readDirectory: (path, extensions, excludes, includes, depth) => {
        if (!canRead(path)) return [];
        return ts.sys.readDirectory(path, extensions, excludes, includes, depth).filter((entry) => canRead(entry));
      },
    };
    const config = ts.parseJsonConfigFileContent(configFile.config, parseHost, dirname(configPath));
    if (config.errors.length > 0) {
      throw new Error(ts.flattenDiagnosticMessageText(config.errors[0]!.messageText, "\n"));
    }
    if (config.fileNames.some((name) => !realPathWithin(workspaceRoot, name))) {
      throw new Error("TypeScript project file is outside the workspace");
    }

    const versions = new Map(config.fileNames.map((name) => [name, "0"]));
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => config.options,
      getScriptFileNames: () => config.fileNames,
      getScriptVersion: (name) => versions.get(name) ?? "0",
      getScriptSnapshot: (name) => {
        if (!canRead(name) || !existsSync(name)) return undefined;
        return ts.ScriptSnapshot.fromString(readFileSync(name, "utf8"));
      },
      getCurrentDirectory: () => dirname(configPath),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (path) => canRead(path) && ts.sys.fileExists(path),
      readFile: (path) => canRead(path) ? ts.sys.readFile(path) : undefined,
      readDirectory: (path, extensions, excludes, includes, depth) => {
        if (!canRead(path)) return [];
        return ts.sys.readDirectory(path, extensions, excludes, includes, depth).filter((entry) => canRead(entry));
      },
      directoryExists: (path) => canRead(path) && (ts.sys.directoryExists?.(path) ?? false),
      getDirectories: (path) => canRead(path) ? (ts.sys.getDirectories?.(path) ?? []).filter((entry) => canRead(resolve(path, entry))) : [],
    };

    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    return { service, fileName, workspaceRoot, dispose: () => service.dispose() };
  }

  private projectSources(workspaceRoot: string): string[] {
    const configs = ts.sys.readDirectory(workspaceRoot, [".json"], ["**/node_modules/**", "**/dist/**"], ["**/tsconfig.json"])
      .filter((path) => realPathWithin(workspaceRoot, path));
    const canRead = (path: string): boolean => realPathWithin(workspaceRoot, path);
    const parseHost: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: (path) => canRead(path) && ts.sys.fileExists(path),
      readFile: (path) => canRead(path) ? ts.sys.readFile(path) : undefined,
      readDirectory: (path, extensions, excludes, includes, depth) => {
        if (!canRead(path)) return [];
        return ts.sys.readDirectory(path, extensions, excludes, includes, depth).filter((entry) => canRead(entry));
      },
    };
    const sources: string[] = [];
    for (const configPath of configs) {
      const configFile = ts.readConfigFile(configPath, (path) => canRead(path) ? readFileSync(path, "utf8") : undefined);
      if (configFile.error) continue;
      const parsed = ts.parseJsonConfigFileContent(configFile.config, parseHost, dirname(configPath));
      if (parsed.errors.length > 0 || parsed.fileNames.some((name) => !canRead(name))) continue;
      const source = parsed.fileNames.find((name) => realPathWithin(workspaceRoot, name));
      if (source) sources.push(relative(workspaceRoot, source));
    }
    if (sources.length === 0) throw new Error("No TypeScript projects found within workspace");
    return sources;
  }
}
