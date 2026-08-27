import { checkShellPolicy } from "./shell-policy.js";
import { checkProtectedPath, secretIn } from "./path-policy.js";
import { checkGitPolicy } from "./git-policy.js";
import { checkInterpreterPolicy } from "./interpreter-policy.js";

export type GuardAction = "shell" | "file_write" | "git" | "network";

export interface GuardCheckInput {
  action: GuardAction;
  command?: string;
  path?: string;
  workspaceRoot?: string;
  content?: string;
  currentBranch?: string;
  protectedBranches?: string[];
}

export interface GuardDecision {
  decision: "allow" | "deny" | "ask";
  policy: string;
  reason: string;
}

export function checkPolicy(input: GuardCheckInput): GuardDecision {
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

  const path = input.path?.trim() ?? "";

  const protectedReason = path ? checkProtectedPath(path, input.workspaceRoot) : undefined;
  if (protectedReason) {
    return {
      decision: "deny",
      policy: "protected-path",
      reason: protectedReason,
    };
  }

  if (input.action === "file_write" && input.content) {
    const secret = secretIn(input.content);
    if (secret) return { decision: "deny", policy: "secret-content", reason: `The proposed content contains ${secret}.` };
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
