import path from "node:path";
import { z } from "zod";
import { listFiles } from "../core/audit/list-files.ts";
import type { Finding } from "../core/audit/finding.ts";
import { MAX_FILE_LINES } from "../shapes/limits.ts";
import { bin, CHECK_TIMEOUT_MS, relativePath, type ToolSet } from "./tool-set.ts";
import { projectTypecheck } from "./typescript.ts";
import { vitest } from "./vitest.ts";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * The harness's rules for owned files, run as a second oxlint pass beside the project's own config. oxlint resolves a
 * config's override globs against that config's folder, so extending the kit's .oxlintrc.json from here would drop its
 * folder overrides; `-c` also skips nested configs, so nothing in the project can turn these rules off.
 */
export const OXLINT_OWNED = path.join(import.meta.dirname, "../presets/oxlint-owned.json");

const lintOutput = z.object({
  diagnostics: z.array(
    z.object({
      message: z.string(),
      code: z.string().optional(),
      filename: z.string(),
      labels: z.array(z.object({ span: z.object({ line: z.number() }) })).optional(),
    }),
  ),
});

/** Every oxlint diagnostic, warnings included, with the rule name inside `plugin(rule)` and paths relative to `dir`. */
function oxlintFindings(dir: string, stdout: string): Finding[] {
  const parsed: unknown = JSON.parse(stdout);
  return lintOutput.parse(parsed).diagnostics.map((diagnostic): Finding => {
    const line = diagnostic.labels?.[0]?.span.line;
    return {
      rule: diagnostic.code === undefined ? "oxlint" : (/\(([^()]+)\)$/.exec(diagnostic.code)?.[1] ?? diagnostic.code),
      file: relativePath(dir, diagnostic.filename),
      ...(line === undefined ? {} : { line }),
      message: diagnostic.message,
    };
  });
}

/** The owned pass's line limit: oxlint puts it in `help`, which the finding does not carry. */
function ownedFindings(dir: string, stdout: string): Finding[] {
  const limit = ` (maximum ${String(MAX_FILE_LINES)} lines, blank lines and comments count)`;
  return oxlintFindings(dir, stdout).map((finding) => (finding.rule === "max-lines" ? { ...finding, message: `${finding.message}${limit}` } : finding));
}

/** One finding per path `oxfmt --list-different` prints; the last line may lack a newline. */
function oxfmtFindings(dir: string, stdout: string): Finding[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line): Finding => ({ rule: "oxfmt", file: relativePath(dir, line.trim()), message: "Run oxfmt on this file." }));
}

export const oxc: ToolSet = {
  name: "oxc",
  format: {
    write: (dir, files) => ({ name: "oxfmt", command: [bin(dir, "oxfmt"), "--no-error-on-unmatched-pattern", ...files], findings: () => [] }),
    check: (dir) => ({
      name: "oxfmt",
      command: [bin(dir, "oxfmt"), "--list-different", "--no-error-on-unmatched-pattern", ...listFiles(dir).filter((file) => SOURCE_FILE.test(file))],
      timeoutMs: CHECK_TIMEOUT_MS,
      findings: (stdout) => oxfmtFindings(dir, stdout),
    }),
  },
  lint: {
    files: (dir, files) => ({
      name: "oxlint",
      command: [bin(dir, "oxlint"), "-f", "json", "--no-error-on-unmatched-pattern", ...files],
      findings: (stdout) => oxlintFindings(dir, stdout),
    }),
    all: (dir) => ({
      name: "oxlint",
      command: [bin(dir, "oxlint"), "-f", "json", "--no-error-on-unmatched-pattern"],
      timeoutMs: CHECK_TIMEOUT_MS,
      findings: (stdout) => oxlintFindings(dir, stdout),
    }),
    owned: (dir, files) => ({
      name: "oxlint-owned",
      command: [bin(dir, "oxlint"), "-c", OXLINT_OWNED, "-f", "json", "--no-error-on-unmatched-pattern", ...files],
      timeoutMs: CHECK_TIMEOUT_MS,
      findings: (stdout) => ownedFindings(dir, stdout),
    }),
  },
  typecheck: { incremental: projectTypecheck, all: projectTypecheck },
  test: vitest,
};
