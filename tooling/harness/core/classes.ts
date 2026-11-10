import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { HarnessConfig } from "../config.ts";
import type { PathRule } from "../shapes/shape.ts";
import type { Finding } from "./audit/finding.ts";
import { isVendoredIn, resolveHarness, type Harness } from "./path-check.ts";

export type PathClass = "owned" | "upstream" | "legacy" | "vendored";

export const legacyList = z.strictObject({ version: z.literal(1), files: z.array(z.string()) });

const PATH_RULES: Record<PathRule, true> = {
  "unknown-root": true,
  "src-shape": true,
  "app-file": true,
  "module-shape": true,
  "shared-shape": true,
  nesting: true,
  "generic-folder": true,
  "file-name": true,
  "js-file": true,
  "hidden-file": true,
};

/** Rules the harness itself enforces; every other finding comes from a tool (tsc, lint, tests, dependency checks). */
export const HARNESS_RULES: ReadonlySet<string> = new Set([
  ...Object.keys(PATH_RULES),
  "folder-size",
  "duplicate-file-name",
  "server-only",
  "use-server-placement",
  "use-client-placement",
  "client-imports-server",
  "index-exports",
  "thin-page",
  "domain-test",
  "env-access",
  "error-text",
  "test-determinism",
  "duplicate-export",
  "inline-disable",
  "package-boundary",
]);

export const ALWAYS_BLOCKS = (finding: Finding): boolean =>
  ["harness-lock", "legacy-append", "legacy-invalid", "migration-applied", "nested-lint-config", "preset-missing"].includes(finding.rule) ||
  finding.rule.endsWith("-failed");

function isOwned(file: string, owned: readonly string[] | undefined): boolean {
  if (owned === undefined) return true;
  return owned.some((prefix) => (prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix || file.startsWith(`${prefix}/`)));
}

export function classify(file: string, harness: Harness, legacy: ReadonlySet<string>): PathClass {
  if (isVendoredIn(harness, file)) return "vendored";
  if (legacy.has(file)) return "legacy";
  const { upstream } = harness;
  if (upstream === undefined) return isOwned(file, harness.config.owned) ? "owned" : "upstream";
  // With an upstream list a file is the project's own unless the kit shipped it; an `owned` prefix claims a kit path.
  return upstream.has(file) && !isOwned(file, harness.config.owned ?? []) ? "upstream" : "owned";
}

/**
 * The workspace-relative files among `files` the harness's own lint rules judge: owned and legacy files, as ESLint does in
 * a next-modules project. The legacy list forgives harness findings, not tool findings.
 */
export function harnessLinted(harness: Harness, legacy: ReadonlySet<string>, workspacePath: string, files: readonly string[]): string[] {
  const judged: ReadonlySet<PathClass> = new Set(["owned", "legacy"]);
  return files.filter((file) => judged.has(classify(workspacePath === "" ? file : `${workspacePath}/${file}`, harness, legacy)));
}

function parseLegacy(gitRoot: string, legacy: string): Set<string> | "invalid" {
  const file = path.join(gitRoot, legacy);
  if (!fs.existsSync(file)) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    parsed = undefined;
  }
  const result = legacyList.safeParse(parsed);
  return result.success ? new Set(result.data.files) : "invalid";
}

/** An invalid list grants nothing: every file is judged by its class as if the list were empty, and legacyInvalidFindings blocks. */
export function readLegacy(gitRoot: string, config: HarnessConfig): Set<string> {
  const files = config.legacy === undefined ? undefined : parseLegacy(gitRoot, config.legacy);
  return files instanceof Set ? files : new Set();
}

export function legacyInvalidFindings(gitRoot: string, config: HarnessConfig): Finding[] {
  const legacy = config.legacy;
  if (legacy === undefined || parseLegacy(gitRoot, legacy) !== "invalid") return [];
  const message = `${legacy} is not a valid legacy list: expected { "version": 1, "files": [paths] }. Restore it with \`git checkout -- ${legacy}\`; the list is locked.`;
  return [{ rule: "legacy-invalid", file: legacy, message }];
}

export const PRE_EXISTING_HEADING = "Pre-existing in legacy files (not blocking):";

/** Whole-repository audits: harness-rule findings on legacy files are reported as pre-existing and never fail. */
export function splitLegacy(gitRoot: string, findings: Finding[]): { blocking: Finding[]; preExisting: Finding[] } {
  const harness = resolveHarness(gitRoot);
  const legacy = readLegacy(gitRoot, harness.config);
  const isLegacy = (finding: Finding): boolean => HARNESS_RULES.has(finding.rule) && classify(finding.file, harness, legacy) === "legacy";
  return { blocking: findings.filter((finding) => !isLegacy(finding)), preExisting: findings.filter(isLegacy) };
}

/** Fast and post-command audits: harness rules judge owned files only; tool findings stay. */
export function dropUnownedHarnessFindings(gitRoot: string, findings: Finding[]): Finding[] {
  const harness = resolveHarness(gitRoot);
  const legacy = readLegacy(gitRoot, harness.config);
  return findings.filter((finding) => !HARNESS_RULES.has(finding.rule) || classify(finding.file, harness, legacy) === "owned");
}
