import { checkShellPolicy } from "./shell-policy.js";

export type GuardAction = "shell" | "file_write" | "git" | "network";

export interface GuardCheckInput {
  action: GuardAction;
  command?: string;
  path?: string;
}

export interface GuardDecision {
  decision: "allow" | "deny" | "ask";
  policy: string;
  reason: string;
}

const protectedPaths = [
  /^\/etc(?:\/|$)/,
  /^\/usr(?:\/|$)/,
  /^\/var(?:\/|$)/,
  /(?:^|\/)\.ssh(?:\/|$)/,
  /(?:^|\/)\.env(?:\.|$)/,
];

export function checkPolicy(input: GuardCheckInput): GuardDecision {
  if ((input.action === "shell" || input.action === "git") && input.command?.trim()) {
    const shell = checkShellPolicy(input.command);
    if (shell) return shell;
  }

  const path = input.path?.trim() ?? "";

  if (path && protectedPaths.some((pattern) => pattern.test(path))) {
    return {
      decision: "deny",
      policy: "protected-path",
      reason: "The proposed path is sensitive or outside a typical project workspace.",
    };
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
