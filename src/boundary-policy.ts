import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { decodeShellEscapes, splitShellSegments, unwrapShellWords } from "./shell.js";
import { checkProtectedPath } from "./path-policy.js";

const TOOL = ["open", "code"].join("");
const TOOL_JSON_RE = new RegExp(`(?:^|/)${TOOL}\\.jsonc?$`, "i");
const TOOL_DIR_RE = new RegExp(`(?:^|/)\\.${TOOL}(?:/|$)`, "i");
const TOOL_CONFIG_RE = new RegExp(`/\\.config/${TOOL}(?:/|\\.jsonc?$)`, "i");

function expandedTarget(path: string): string | undefined {
  const trimmed = path.trim().replace(/^["']|["']$/g, "");
  const home = process.env.HOME || homedir();
  if (trimmed === "~") return home;
  if (/^~[/\\]/.test(trimmed)) return join(home, trimmed.slice(2));
  if (/^~[A-Za-z0-9_.-]+(?:[/\\]|$)/.test(trimmed)) {
    const [user, ...rest] = trimmed.slice(1).split(/[/\\]/);
    return join(dirname(home), user!, ...rest);
  }
  const out = trimmed.replace(/^\$(?:HOME|\{HOME\})(?=$|[/\\])/, home);
  return out.includes("$") ? undefined : out;
}

function realPathWithMissingTail(path: string): string | undefined {
  let ancestor = path;
  while (true) {
    try { return resolve(realpathSync(ancestor), relative(ancestor, path)); } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return undefined;
      ancestor = parent;
    }
  }
}

function outsideWorkspace(path: string, root: string): boolean {
  const expanded = expandedTarget(path);
  if (expanded === undefined) return true;
  const resolved = resolve(root, expanded);
  const realRoot = realPathWithMissingTail(resolve(root)) ?? resolve(root);
  const real = realPathWithMissingTail(resolved) ?? resolved;
  const lexicalRelative = relative(resolve(root), resolved);
  const realRelative = relative(realRoot, real);
  const escapes = (value: string) => value === ".." || value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(value);
  return escapes(lexicalRelative) || escapes(realRelative);
}

function mutationPaths(segment: string): { targets: string[]; moveSources: string[] } {
  const words = unwrapShellWords(segment);
  const command = basename(words[0] ?? "");
  const targets: string[] = [];
  const moveSources: string[] = [];
  for (const match of segment.matchAll(/(?:^|[\s>]|(?<=[^\s"']))(?:\d*&?)?>{1,2}\s*["']?([^\s>&|;"']+)/g)) if (match[1]) targets.push(match[1]);
  if (command === "tee") targets.push(...words.slice(1).filter((word) => !word.startsWith("-")));
  if (command === "dd") targets.push(...words.slice(1).filter((word) => word.startsWith("of=")).map((word) => word.slice(3)));
  if (["touch", "mkdir", "rm", "unlink", "rmdir", "truncate", "chmod", "chown", "chgrp"].includes(command)) targets.push(...words.slice(1).filter((word) => !word.startsWith("-")));
  if (["cp", "mv", "ln", "install"].includes(command)) {
    const operands: string[] = [];
    let targetDirectory: string | undefined;
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i]!;
      if (word === "-t" || word === "--target-directory") { targetDirectory = words[++i]; continue; }
      if (/^-t.+/.test(word)) { targetDirectory = word.slice(2); continue; }
      if (word.startsWith("--target-directory=")) { targetDirectory = word.slice("--target-directory=".length); continue; }
      if (!word.startsWith("-")) operands.push(word);
    }
    if (targetDirectory) targets.push(targetDirectory); else if (operands.length) targets.push(operands.at(-1)!);
    if (command === "mv") moveSources.push(...(targetDirectory ? operands : operands.slice(0, -1)));
  }
  if (command === "sed" && words.slice(1).some((word) => /^-(?:[A-Za-z]*i|i\S*)$/.test(word) || /^--in-place(?:=.*)?$/.test(word))) {
    let scriptSupplied = false;
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i]!;
      if (/^-(?:[A-Za-z]*i|i\S*)$/.test(word) || /^--in-place(?:=.*)?$/.test(word)) continue;
      if (word === "-e" || word === "--expression" || word === "-f" || word === "--file") { scriptSupplied = true; i += 1; continue; }
      if (word.startsWith("-")) { if (/^(?:-e|--expression=)/.test(word)) scriptSupplied = true; continue; }
      if (!scriptSupplied) { scriptSupplied = true; continue; }
      targets.push(word);
    }
  }
  return { targets, moveSources };
}

function isGuardConfigurationPath(path: string, workspaceRoot?: string): boolean {
  const expanded = expandedTarget(path);
  if (expanded === undefined) return true;
  const resolved = resolve(workspaceRoot ?? process.cwd(), expanded).replaceAll("\\", "/");
  return TOOL_JSON_RE.test(resolved) || /(?:^|\/)workflow-guard\.jsonc?$/i.test(resolved) || TOOL_DIR_RE.test(resolved) || TOOL_CONFIG_RE.test(resolved);
}

export function checkBoundaryPolicy(command: string, workspaceRoot?: string): { policy: string; decision: "deny"; reason: string } | undefined {
  const normalized = decodeShellEscapes(command).replace(/'([^']*)'/g, "$1").replace(/"([^"]*)"/g, "$1").replace(new RegExp(`${TOOL}\\.jso[?]|${TOOL}\\.[?*]`, "gi"), `${TOOL}.json`);
  const toolCommand = new RegExp(`(?:^|\\s)${TOOL}\\s+(?:-[^|;&]*\\s+)*(?:auth|config|permission)\\b`, "i");
  const autoCommand = new RegExp(`(?:^|\\s)${TOOL}\\s+(?:run\\s+)?--auto\\b`, "i");
  if (toolCommand.test(normalized) || autoCommand.test(normalized)) return { decision: "deny", policy: "guard-tamper", reason: "Changing host auth, permissions, or guard configuration from the agent is not allowed." };
  for (const segment of splitShellSegments(command)) {
    const { targets, moveSources } = mutationPaths(segment);
    for (const path of [...targets, ...moveSources]) {
      if (isGuardConfigurationPath(path, workspaceRoot)) return { decision: "deny", policy: "guard-tamper", reason: "Modifying host or workflow-guard configuration from the agent is not allowed." };
      if (checkProtectedPath(path, workspaceRoot)) return { decision: "deny", policy: "protected-shell-path", reason: `Shell mutation targets protected path '${path}'.` };
      if (workspaceRoot && outsideWorkspace(path, workspaceRoot)) return { decision: "deny", policy: "workspace-boundary", reason: `Shell mutation targets '${path}' outside workspace '${workspaceRoot}'.` };
    }
  }
  return undefined;
}
