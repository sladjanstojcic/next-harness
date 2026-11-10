import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { analysisOf, CONFIG_FILE } from "../../config.ts";
import { ALWAYS_BLOCKS, classify, HARNESS_RULES, legacyInvalidFindings, readLegacy, type PathClass } from "../classes.ts";
import { realPath } from "../hooks/shell.ts";
import { legacyAppendFindings } from "../legacy.ts";
import { migrationFindings } from "../hooks/migration-guard.ts";
import { lockFindings } from "../lock.ts";
import { resolveHarness } from "../path-check.ts";
import { withGateLock } from "../state/run-lock.ts";
import { stateDir } from "../state/state-file.ts";
import { depcruise, jscpd, knip } from "../../tools/analysis.ts";
import { ALL_TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { toolWorkspaces, workspaceTools } from "../../tools/index.ts";
import { relativePath } from "../../tools/tool-set.ts";
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

/** `base` is the task's starting tree; without it, changed migrations are judged against HEAD. */
export async function doneGate(root: string, changed: string[], base?: string): Promise<GateResult> {
  if (changed.length === 0) return { passed: true, findings: [], preExisting: [], report: "" };
  const directory = realPath(path.resolve(root));
  // Type generation and incremental tsc write shared files; parallel agents in one checkout take turns.
  return withGateLock(directory, () => runDoneGate(directory, changed, base));
}

async function runDoneGate(directory: string, changed: string[], base: string | undefined): Promise<GateResult> {
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
  }
  for (const { workspace, tools, dir } of toolWorkspaces(directory, harness.workspaces)) {
    if (tools.lint.preset !== undefined && presetInputChanged(changedPaths, workspace.path))
      await run(workspace.path, tools.lint.preset(dir, workspace.path, workspace.next));
  }
  all.push(
    ...audit(directory),
    ...lockFindings(directory, changedPaths, harness.config),
    ...migrationFindings(directory, harness, changedPaths, base),
    ...legacyAppendFindings(directory, harness.config),
    ...legacyInvalidFindings(directory, harness.config),
  );
  for (const { workspace, dir, files } of groups) {
    const analysis = new Set(analysisOf(harness.config, workspace));
    if (analysis.has("depcruise"))
      await run(
        workspace.path,
        depcruise.report(dir, new Set(files), (result) => {
          for (const file of result) affected.add(path.posix.join(workspace.path, file));
        }),
      );
    if (analysis.has("knip")) await run(workspace.path, knip.report(dir));
    if (analysis.has("jscpd")) {
      const output = fs.mkdtempSync(path.join(stateDir(directory), "jscpd-"));
      try {
        await run(workspace.path, jscpd.report(dir, output, workspace.path));
      } finally {
        fs.rmSync(output, { recursive: true, force: true });
      }
    }
  }
  for (const { workspace, tools, dir, files } of groups) await run(workspace.path, tools.test.related(dir, files), true);
  const blockingPaths = affected;
  const isHarnessRule = (finding: Finding): boolean => HARNESS_RULES.has(finding.rule);
  const classOf = (finding: Finding): PathClass => classify(finding.file, harness, legacy);
  const blocks = (finding: Finding): boolean =>
    ALWAYS_BLOCKS(finding) || (blockingPaths.has(finding.file) && (!isHarnessRule(finding) || classOf(finding) === "owned"));
  const findings = all.filter(blocks);
  // Upstream tool findings outside this turn's files are the kit's, not the agent's: dropped rather than reported.
  const preExisting = all.filter((finding) => !blocks(finding) && (isHarnessRule(finding) || classOf(finding) !== "upstream"));
  const report = [stableReport(findings), preExisting.length > 0 ? `Outside this turn's files (not blocking):\n${stableReport(preExisting)}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return { passed: findings.length === 0, findings, preExisting, report };
}
