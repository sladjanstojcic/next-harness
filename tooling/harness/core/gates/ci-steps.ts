import fs from "node:fs";
import path from "node:path";
import { analysisOf } from "../../config.ts";
import { depcruise, jscpd, knip } from "../../tools/analysis.ts";
import type { WorkspaceTools } from "../../tools/index.ts";
import { testScript } from "../../tools/test-script.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import type { Harness } from "../path-check.ts";
import type { ToolStep } from "./run-tool.ts";

/** A step a gate names in its report without running it. */
export interface SkippedStep {
  name: string;
  skipped: string;
}

/**
 * depcruise and jscpd read src/. A workspace of a configured repository that has none yet, as an adopted app keeps its own
 * layout, skips them until src/ appears; without harness.config.ts they run as before.
 */
export function lacksSources(harness: Harness, dir: string): boolean {
  return harness.configured && !fs.existsSync(path.join(dir, "src"));
}

export const skippedLine = (name: string, workspacePath: string, reason: string): string =>
  `${workspacePath === "" ? name : `${name} (${workspacePath})`}: skipped (${reason})`;

/**
 * A workspace's whole-tree format, lint and type steps. Judged by exit code as CI always did, or with `perFile` one
 * finding per file, which a legacy list needs to tell old debt from new.
 */
export function checkSteps({ tools, dir, workspace }: WorkspaceTools, perFile: boolean): { format: ToolStep; lint: ToolStep; types: ToolStep[] } {
  if (!perFile) return { format: tools.format.check(dir), lint: tools.lint.all(dir), types: tools.typecheck.all(dir, workspace.next) };
  return {
    format: tools.format.report?.(dir) ?? tools.format.check(dir),
    lint: tools.lint.report?.(dir) ?? tools.lint.all(dir),
    types: tools.typecheck.report?.(dir, workspace.next) ?? tools.typecheck.all(dir, workspace.next),
  };
}

/** A workspace's depcruise, knip and jscpd steps, in that order; `output` is a folder for jscpd's per-file report. */
export function analysisSteps(harness: Harness, { dir, workspace }: WorkspaceTools, perFile: boolean, output: string): (ToolStep | SkippedStep)[] {
  const analysis = new Set(analysisOf(harness.config, workspace));
  const sourceless = lacksSources(harness, dir);
  const sources = (name: string, step: () => ToolStep): ToolStep | SkippedStep => (sourceless ? { name, skipped: "no src/" } : step());
  return [
    ...(analysis.has("depcruise") ? [sources("depcruise", () => (perFile ? depcruise.report(dir, new Set(), () => undefined) : depcruise.check(dir)))] : []),
    ...(analysis.has("knip") ? [perFile ? knip.report(dir) : knip.check(dir)] : []),
    ...(analysis.has("jscpd") ? [sources("jscpd", () => (perFile ? jscpd.report(dir, output, workspace.path) : jscpd.check(dir, workspace.path)))] : []),
  ];
}

/** The whole test run of a workspace: its own package script when harness.config.ts names one, else the tool set's runner. */
export function testStep(root: string, { tools, dir, workspace }: WorkspaceTools): ToolStep {
  return workspace.test === undefined ? tools.test.all(dir) : testScript(root, dir, workspace.test);
}

const LISTED_PER_STEP = 5;

/** Old debt in short: a count per step, the first findings of each, and how many the list leaves out. */
export function summarizePreExisting(byStep: ReadonlyMap<string, Finding[]>): string {
  const steps = [...byStep].filter(([, found]) => found.length > 0);
  const count = (total: number, noun: string): string => `${String(total)} ${noun}${total === 1 ? "" : "s"}`;
  const counts = steps.map(([name, found]) => `${name}: ${count(found.length, "finding")} in ${count(new Set(found.map(({ file }) => file)).size, "file")}`);
  const listed = steps.flatMap(([, found]) => found.slice(0, LISTED_PER_STEP));
  const omitted = steps.reduce((total, [, found]) => total + found.length, 0) - listed.length;
  const more = omitted > 0 ? [`… and ${String(omitted)} more, not listed; \`pnpm run audit\` and each tool print theirs in full.`] : [];
  return [...counts, formatFindings(listed), ...more].join("\n");
}
