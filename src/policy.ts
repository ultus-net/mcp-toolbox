import { checkShellPolicy } from "./shell-policy.js";
import { checkProtectedPath, secretIn } from "./path-policy.js";
import { checkGitPolicy, protectedBranchWriteReason } from "./git-policy.js";
import { checkInterpreterPolicy } from "./interpreter-policy.js";
import { checkBoundaryPolicy, isPathOutsideWorkspace } from "./boundary-policy.js";

export type GuardAction = "shell" | "file_write" | "git" | "network";

export interface GuardCheckInput {
  action: GuardAction;
  command?: string;
  path?: string;
  workspaceRoot?: string;
  content?: string;
  patchText?: string;
  currentBranch?: string;
  protectedBranches?: string[];
}

export interface GuardDecision {
  decision: "allow" | "deny" | "ask";
  policy: string;
  reason: string;
}

export function extractPatchPaths(patchText: string): string[] {
  const paths: string[] = [];
  for (const match of patchText.matchAll(/^\*\*\*\s+(?:Add File|Update File|Delete File|Move to|Move from):\s*(.+?)\s*$/gm)) {
    if (match[1]) paths.push(match[1]);
  }
  for (const match of patchText.matchAll(/^(?:---|\+\+\+)\s+(?:[ab]\/)?(\S+)/gm)) {
    if (match[1] && match[1] !== "/dev/null") paths.push(match[1]);
  }
  return paths;
}

export function checkPolicy(input: GuardCheckInput): GuardDecision {
  if ((input.action === "shell" || input.action === "git") && input.command?.trim()) {
    const boundary = checkBoundaryPolicy(input.command, input.workspaceRoot);
    if (boundary) return boundary;
  }
  if ((input.action === "shell" || input.action === "git") && input.command?.trim()) {
    const interpreter = checkInterpreterPolicy(input.command, input.workspaceRoot);
    if (interpreter) return interpreter;
  }
  if ((input.action === "shell" || input.action === "git") && input.command?.trim()) {
    const git = checkGitPolicy(input.command, { currentBranch: input.currentBranch, protectedBranches: input.protectedBranches });
    if (git) return git;
  }
  if ((input.action === "shell" || input.action === "git") && input.command?.trim()) {
    const shell = checkShellPolicy(input.command);
    if (shell) return shell;
  }

  const paths = [input.path?.trim() ?? "", ...(input.action === "file_write" && input.patchText ? extractPatchPaths(input.patchText) : [])].filter(Boolean);

  for (const path of paths) {
    const protectedReason = checkProtectedPath(path, input.workspaceRoot);
    if (protectedReason) {
      return {
        decision: "deny",
        policy: "protected-path",
        reason: protectedReason,
      };
    }
    if (input.action === "file_write" && input.patchText && input.workspaceRoot && isPathOutsideWorkspace(path, input.workspaceRoot)) {
      return { decision: "deny", policy: "workspace-boundary", reason: `Patch target '${path}' is outside workspace '${input.workspaceRoot}'.` };
    }
  }

  if (input.action === "file_write" && input.content) {
    const secret = secretIn(input.content);
    if (secret) return { decision: "deny", policy: "secret-content", reason: `The proposed content contains ${secret}.` };
  }

  if (input.action === "file_write") {
    const branchReason = protectedBranchWriteReason({ currentBranch: input.currentBranch, protectedBranches: input.protectedBranches });
    if (branchReason) return { decision: "deny", policy: "protected-branch-write", reason: branchReason };
  }

  if (input.action === "network") {
    return {
      decision: "ask",
      policy: "external-side-effect",
      reason: "External side effects should require explicit user approval.",
    };
  }

  return {
    decision: "allow",
    policy: "baseline",
    reason: "No baseline high-risk policy matched the proposed action.",
  };
}
