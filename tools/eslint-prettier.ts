import path from "node:path";
import { z } from "zod";
import type { Finding } from "../core/audit/finding.ts";
import { bin, CHECK_TIMEOUT_MS, type ToolSet } from "./tool-set.ts";
import { fullTypecheck, incrementalTypecheck } from "./typescript.ts";
import { vitest } from "./vitest.ts";

const lintOutput = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        ruleId: z.string().nullable(),
        severity: z.number(),
        message: z.string(),
        line: z.number().optional(),
      }),
    ),
  }),
);

function eslintFindings(root: string, stdout: string): Finding[] {
  const parsed: unknown = JSON.parse(stdout);
  return lintOutput.parse(parsed).flatMap((result) =>
    result.messages
      .filter((message) => message.severity > 0)
      .map((message): Finding => ({
        rule: message.ruleId ?? "eslint",
        file: path.relative(root, result.filePath).split(path.sep).join("/"),
        ...(message.line === undefined ? {} : { line: message.line }),
        message: message.message,
      })),
  );
}

export const eslintPrettier: ToolSet = {
  name: "eslint-prettier",
  format: {
    write: (dir, files) => ({ name: "prettier", command: [bin(dir, "prettier"), "--write", "--ignore-unknown", "--", ...files], findings: () => [] }),
    check: (dir) => ({ name: "prettier", command: [bin(dir, "prettier"), "--check", "."], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }),
  },
  lint: {
    files: (dir, files, fast) => ({
      name: "eslint",
      command: [...(fast ? ["/usr/bin/env", "HARNESS_FAST_LINT=1"] : []), bin(dir, "eslint"), "--format", "json", "--no-warn-ignored", "--", ...files],
      findings: (stdout) => eslintFindings(dir, stdout),
    }),
    all: (dir) => ({ name: "eslint", command: [bin(dir, "eslint"), ".", "--max-warnings", "0"], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }),
  },
  typecheck: { incremental: incrementalTypecheck, all: fullTypecheck },
  test: vitest,
};
