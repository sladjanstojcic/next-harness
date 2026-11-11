import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { analysisOf, CONFIG_FILE } from "../../config.ts";
import { ALWAYS_BLOCKS, classify, HARNESS_RULES, legacyInvalidFindings, harnessLinted, readLegacy, type PathClass } from "../classes.ts";
import { realPath } from "../hooks/shell.ts";
import { legacyAppendFindings } from "../legacy.ts";
import { lintConfigFindings } from "../hooks/lint-config-guard.ts";
import { type Applied, migrationFindings, taskApplied } from "../hooks/migration-guard.ts";
import { lockFindings } from "../lock.ts";
import { resolveHarness } from "../path-check.ts";
import { withGateLock } from "../state/run-lock.ts";
import { stateDir } from "../state/state-file.ts";
import { depcruise, jscpd } from "../../tools/analysis.ts";
import { ALL_TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { toolWorkspaces, workspaceTools } from "../../tools/index.ts";
import { testScript } from "../../tools/test-script.ts";
import { relativePath } from "../../tools/tool-set.ts";
import { knipStep, lacksSources, skippedLine, summarizePreExisting } from "./ci-steps.ts";
import { runInWorkspace, selectedPaths } from "./fast-gate.ts";
import type { GateResult } from "./gate-result.ts";
import type { ToolStep } from "./run-tool.ts";

// Tool failure output (notably Vitest) can contain timings; they must not reset identical-failure detection.
function stableReport(findings: Finding[]): string {
  return stripVTControlCharacters(formatFindings(findings))
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "<time>")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds|milliseconds)\b/g, "<duration>");
}

/**
 * A workspace's effective lint config can change with a tool config in its folder or any folder above it (ESLint looks
 * upward for one), with its package.json, or with the harness config.
 */
function presetInputChanged(changed: ReadonlySet<string>, workspacePath: string): boolean {
  if (changed.has(CONFIG_FILE) || changed.has(workspacePath === "" ? "package.json" : `${workspacePath}/package.json`)) return true;
  const parts = workspacePath === "" ? [] : workspacePath.split("/");
  const folders = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  return ["", ...folders].some((folder) => ALL_TOOL_CONFIG_NAMES.some((name) => changed.has(folder === "" ? name : `${folder}/${name}`)));
}

/** `applied` holds the task's pinned migration versions; without it, migrations are judged against the refs now, else HEAD. */
export async function doneGate(root: string, changed: string[], applied?: Applied): Promise<GateResult> {
  const directory = realPath(path.resolve(root));
  if (changed.length === 0) {
    // A git-ignored lint config changes no tracked path, yet the linters read it.
    const findings = fs.existsSync(path.join(directory, CONFIG_FILE)) ? lintConfigFindings(directory, resolveHarness(directory)) : [];
    return { passed: findings.length === 0, findings, preExisting: [], report: stableReport(findings) };
  }
  // Type generation and incremental tsc write shared files; parallel agents in one checkout take turns.
  return withGateLock(directory, () => runDoneGate(directory, changed, applied));
}

async function runDoneGate(directory: string, changed: string[], applied: Applied | undefined): Promise<GateResult> {
  const changedPaths = new Set(changed.map((file) => relativePath(directory, file)));
  const harness = resolveHarness(directory);
  const legacy = readLegacy(directory, harness.config);
  const groups = workspaceTools(directory, harness.workspaces, [...changedPaths]);
  const sources = selectedPaths(directory, changed, harness).filter((file) => /\.tsx?$/.test(file));
  const sourceGroups = workspaceTools(directory, harness.workspaces, sources);
  const affected = new Set(changedPaths);
  const all: Finding[] = [];
  const run = async (workspacePath: string, step: ToolStep, optional = false): Promise<void> => {
    all.push(...(await runInWorkspace(directory, workspacePath, step, optional)));
  };
  for (const { workspace, tools, dir } of groups) {
    for (const step of tools.typecheck.incremental(dir, workspace.next)) await run(workspace.path, step);
    const files = sourceGroups.find((group) => group.workspace === workspace)?.files ?? [];
    if (files.length > 0) await run(workspace.path, tools.lint.files(dir, files, false));
    const owned = harnessLinted(harness, legacy, workspace.path, files);
    if (tools.lint.owned !== undefined && owned.length > 0) await run(workspace.path, tools.lint.owned(dir, owned));
  }
  for (const { workspace, tools, dir } of toolWorkspaces(directory, harness.workspaces)) {
    if (tools.lint.preset !== undefined && presetInputChanged(changedPaths, workspace.path)) await run(workspace.path, tools.lint.preset(dir, workspace));
  }
  all.push(
    ...audit(directory),
    ...lockFindings(directory, changedPaths, harness.config),
    ...migrationFindings(directory, harness, changedPaths, () => applied ?? taskApplied(directory, null)),
    ...lintConfigFindings(directory, harness),
    ...legacyAppendFindings(directory, harness.config),
    ...legacyInvalidFindings(directory, harness.config),
  );
  const skipped: string[] = [];
  for (const group of groups) {
    const { workspace, dir, files } = group;
    const analysis = new Set(analysisOf(harness.config, workspace));
    if (lacksSources(harness, dir, workspace)) {
      for (const name of ["depcruise", "jscpd"] as const) if (analysis.delete(name)) skipped.push(skippedLine(name, workspace.path, "no src/"));
    }
    if (analysis.has("depcruise"))
      await run(
        workspace.path,
        depcruise.report(dir, workspace, new Set(files), (result) => {
          for (const file of result) affected.add(path.posix.join(workspace.path, file));
        }),
      );
    if (analysis.has("knip")) await run(workspace.path, knipStep(directory, group, true));
    if (analysis.has("jscpd")) {
      const output = fs.mkdtempSync(path.join(stateDir(directory), "jscpd-"));
      try {
        await run(workspace.path, jscpd.report(dir, output, workspace));
      } finally {
        fs.rmSync(output, { recursive: true, force: true });
      }
    }
  }
  // A workspace's own test script has no notion of related tests: it runs whole.
  for (const { workspace, tools, dir, files } of groups)
    await run(workspace.path, workspace.test === undefined ? tools.test.related(dir, files) : testScript(directory, dir, workspace.test), true);
  const blockingPaths = affected;
  const isHarnessRule = (finding: Finding): boolean => HARNESS_RULES.has(finding.rule);
  const classOf = (finding: Finding): PathClass => classify(finding.file, harness, legacy);
  const blocks = (finding: Finding): boolean =>
    ALWAYS_BLOCKS(finding) || (blockingPaths.has(finding.file) && (!isHarnessRule(finding) || classOf(finding) === "owned"));
  const findings = all.filter(blocks);
  // Upstream tool findings outside this turn's files are the kit's, not the agent's: dropped rather than reported.
  const preExisting = all.filter((finding) => !blocks(finding) && (isHarnessRule(finding) || classOf(finding) !== "upstream"));
  // With a legacy list the old debt runs to thousands of lines: counts and the first findings, as CI prints it.
  const outside = (found: Finding[]): string =>
    harness.config.legacy === undefined
      ? stableReport(found)
      : summarizePreExisting(
          new Map([
            ["harness rules", found.filter(isHarnessRule)],
            ["tools", found.filter((finding) => !isHarnessRule(finding))],
          ]),
        );
  const report = [
    stableReport(findings),
    preExisting.length > 0 ? `Outside this turn's files (not blocking):\n${outside(preExisting)}` : "",
    skipped.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { passed: findings.length === 0, findings, preExisting, report };
}
