#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkPolicy } from "./policy.js";

const server = new McpServer({ name: "workflow-guard-mcp", version: "0.1.0" });

server.registerTool(
  "guard_check",
  {
    description: "Evaluate a proposed coding-agent action. Advisory unless the host wires the result into enforcement.",
    inputSchema: {
      action: z.enum(["shell", "file_write", "git", "network"]),
      command: z.string().optional(),
      path: z.string().optional(),
      workspaceRoot: z.string().optional(),
      content: z.string().optional(),
      currentBranch: z.string().optional(),
      protectedBranches: z.array(z.string()).optional(),
    },
  },
  async (input) => {
    const decision = checkPolicy(input);
    return {
      content: [{ type: "text", text: JSON.stringify(decision) }],
      structuredContent: {
        decision: decision.decision,
        policy: decision.policy,
        reason: decision.reason,
      },
    };
  },
);

server.registerTool(
  "guard_status",
  {
    description: "Report guard capabilities and the enforcement boundary.",
    inputSchema: {},
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({ mode: "policy-advisor", enforcement: "host-dependent", executesActions: false }),
    }],
  }),
);

await server.connect(new StdioServerTransport());
