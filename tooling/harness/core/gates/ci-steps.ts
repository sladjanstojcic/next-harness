import { analysisOf, sourcePaths, sourceRootOf, type WorkspaceEntry } from "../../config.ts";
import { shapeOf } from "../../shapes/index.ts";
import { depcruise, jscpd, knip } from "../../tools/analysis.ts";
import type { WorkspaceTools } from "../../tools/index.ts";
import { testScript } from "../../tools/test-script.ts";
import { typecheckProjects } from "../../tools/typescript.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { importedFromPackage } from "../package-usage.ts";
import type { Harness } from "../path-check.ts";
import type { SkippedStep, ToolStep } from "./run-tool.ts";

/**
 * depcruise and jscpd read the workspace's source folders: src/, or app/, modules/ and shared/ at its top. A workspace of a
 * configured repository with neither src/ nor app/ yet skips them until one appears; without harness.config.ts they run as before.
 */
export function lacksSources(harness: Harness, dir: string, workspace: WorkspaceEntry): boolean {
  return harness.configured && sourcePaths(dir, sourceRootOf(workspace)).length === 0;
}

export const skippedLine = (name: string, workspacePath: string, reason: string): string =>
  `${workspacePath === "" ? name : `${name} (${workspacePath})`}: skipped (${reason})`;

/**
 * A workspace's whole-tree format, lint and type steps. Judged by exit code as CI always did, or with `perFile` one
 * finding per file, which a legacy list needs to tell old debt from new.
 */
export function checkSteps({ tools, dir, workspace }: WorkspaceTools, perFile: boolean): { format: ToolStep | SkippedStep; lint: ToolStep; types: ToolStep[] } {
  const projects = typecheckProjects(dir, workspace);
  const vendored = shapeOf(workspace.shape, sourceRootOf(workspace)).vendoredPattern;
  if (!perFile)
    return { format: tools.format.check(dir, vendored), lint: tools.lint.all(dir, vendored), types: tools.typecheck.all(dir, workspace.next, projects) };
  return {
    format: tools.format.report?.(dir, vendored) ?? tools.format.check(dir, vendored),
    lint: tools.lint.report?.(dir) ?? tools.lint.all(dir, vendored),
    types: tools.typecheck.report?.(dir, workspace.next, projects) ?? tools.typecheck.all(dir, workspace.next, projects),
  };
}

/** Knip for one workspace: a package is judged with what the rest of the repository imports from it, always by its report. */
export function knipStep(root: string, { dir, workspace }: WorkspaceTools, perFile: boolean): ToolStep {
  if (workspace.shape === "package") return knip.package(dir, () => importedFromPackage(root, workspace.path));
  return perFile ? knip.report(dir) : knip.check(dir);
}

/** A workspace's depcruise, knip and jscpd steps, in that order; `output` is a folder for jscpd's per-file report. */
export function analysisSteps(root: string, harness: Harness, group: WorkspaceTools, perFile: boolean, output: string): (ToolStep | SkippedStep)[] {
  const { dir, workspace } = group;
  const analysis = new Set(analysisOf(harness.config, workspace));
  const sourceless = lacksSources(harness, dir, workspace);
  const sources = (name: string, step: () => ToolStep): ToolStep | SkippedStep => (sourceless ? { name, skipped: "no src/" } : step());
  return [
    ...(analysis.has("depcruise")
      ? [sources("depcruise", () => (perFile ? depcruise.report(dir, workspace, new Set(), () => undefined) : depcruise.check(dir, workspace)))]
      : []),
    ...(analysis.has("knip") ? [knipStep(root, group, perFile)] : []),
    ...(analysis.has("jscpd") ? [sources("jscpd", () => (perFile ? jscpd.report(dir, output, workspace) : jscpd.check(dir, workspace)))] : []),
  ];
}

/** A pocketbase workspace's tests need a running PocketBase, so without a test script of its own the gates run none there. */
export function skippedTest(workspace: WorkspaceEntry): SkippedStep | undefined {
  return workspace.shape === "pocketbase" && workspace.test === undefined ? { name: "test", skipped: "no test script" } : undefined;
}

/** The whole test run of a workspace: its own package script when harness.config.ts names one, else the tool set's runner. */
export function testStep(root: string, { tools, dir, workspace }: WorkspaceTools): ToolStep | SkippedStep {
  if (workspace.test !== undefined) return testScript(root, dir, workspace.test);
  return skippedTest(workspace) ?? tools.test.all(dir);
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
