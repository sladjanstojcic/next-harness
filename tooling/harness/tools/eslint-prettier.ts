import path from "node:path";
import { z } from "zod";
import type { Finding } from "../core/audit/finding.ts";
import { eslintPreset } from "./eslint-preset.ts";
import { bin, CHECK_TIMEOUT_MS, relativePath, type ToolSet } from "./tool-set.ts";
import { fullTypecheck, incrementalTypecheck, reportTypecheck } from "./typescript.ts";
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

/** One finding per path `prettier --list-different` prints; exit code 2 is a file Prettier could not read at all. */
function prettierFindings(dir: string, stdout: string, exitCode: number): Finding[] {
  const files = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  const unformatted = files.map((line): Finding => ({ rule: "prettier", file: relativePath(dir, line.trim()), message: "Run prettier --write on this file." }));
  const failed: Finding = { rule: "prettier-failed", file: "", message: "prettier could not check every file; run prettier --check . for the error." };
  return exitCode > 1 && unformatted.length > 0 ? [...unformatted, failed] : unformatted;
}

export const eslintPrettier: ToolSet = {
  name: "eslint-prettier",
  format: {
    write: (dir, files) => ({ name: "prettier", command: [bin(dir, "prettier"), "--write", "--ignore-unknown", "--", ...files], findings: () => [] }),
    check: (dir) => ({ name: "prettier", command: [bin(dir, "prettier"), "--check", "."], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }),
    report: (dir) => ({
      name: "prettier",
      command: [bin(dir, "prettier"), "--list-different", "."],
      timeoutMs: CHECK_TIMEOUT_MS,
      findings: (stdout, exitCode) => prettierFindings(dir, stdout, exitCode),
    }),
  },
  lint: {
    files: (dir, files, fast) => ({
      name: "eslint",
      command: [...(fast ? ["/usr/bin/env", "HARNESS_FAST_LINT=1"] : []), bin(dir, "eslint"), "--format", "json", "--no-warn-ignored", "--", ...files],
      findings: (stdout) => eslintFindings(dir, stdout),
    }),
    all: (dir) => ({ name: "eslint", command: [bin(dir, "eslint"), ".", "--max-warnings", "0"], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }),
    report: (dir) => ({
      name: "eslint",
      command: [bin(dir, "eslint"), ".", "--format", "json"],
      timeoutMs: CHECK_TIMEOUT_MS,
      findings: (stdout) => eslintFindings(dir, stdout),
    }),
    preset: eslintPreset,
  },
  typecheck: { incremental: incrementalTypecheck, all: fullTypecheck, report: reportTypecheck },
  test: vitest,
};
