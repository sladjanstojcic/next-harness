import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { ALWAYS_BLOCKS, classify, HARNESS_RULES, legacyInvalidFindings, readLegacy, type PathClass } from "../classes.ts";
import { realPath } from "../hooks/shell.ts";
import { legacyAppendFindings } from "../legacy.ts";
import { lockFindings } from "../lock.ts";
import { resolveHarness } from "../path-check.ts";
import { withGateLock } from "../state/run-lock.ts";
import { stateDir } from "../state/state-file.ts";
import { depcruise, jscpd, knip } from "../../tools/analysis.ts";
import { workspaceTools } from "../../tools/index.ts";
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

export async function doneGate(root: string, changed: string[]): Promise<GateResult> {
  if (changed.length === 0) return { passed: true, findings: [], preExisting: [], report: "" };
  const directory = realPath(path.resolve(root));
  // Type generation and incremental tsc write shared files; parallel agents in one checkout take turns.
  return withGateLock(directory, () => runDoneGate(directory, changed));
}

async function runDoneGate(directory: string, changed: string[]): Promise<GateResult> {
  const changedPaths = new Set(changed.map((file) => relativePath(directory, file)));
  const harness = resolveHarness(directory);
  const legacy = readLegacy(directory, harness.config);
  const groups = workspaceTools(directory, harness.workspaces, [...changedPaths]);
  const sources = selectedPaths(directory, changed, harness).filter((file) => /\.tsx?$/.test(file));
  const sourceGroups = workspaceTools(directory, harness.workspaces, sources);
  const analysis = new Set(harness.config.analysis ?? []);
  let affected: Set<string> | undefined;
  const all: Finding[] = [];
  const run = async (workspacePath: string, step: ToolStep, optional = false): Promise<void> => {
    all.push(...(await runInWorkspace(directory, workspacePath, step, optional)));
  };
  for (const { workspace, tools, dir } of groups) {
    for (const step of tools.typecheck.incremental(dir, workspace.next)) await run(workspace.path, step);
    const files = sourceGroups.find((group) => group.workspace === workspace)?.files ?? [];
    if (files.length > 0) await run(workspace.path, tools.lint.files(dir, files, false));
  }
  all.push(
    ...audit(directory),
    ...lockFindings(directory, changedPaths, harness.config),
    ...legacyAppendFindings(directory, harness.config),
    ...legacyInvalidFindings(directory, harness.config),
  );
  if (analysis.has("depcruise"))
    await run(
      "",
      depcruise.report(directory, changedPaths, (result) => {
        affected = result;
      }),
    );
  if (analysis.has("knip")) await run("", knip.report(directory));
  if (analysis.has("jscpd")) {
    const output = fs.mkdtempSync(path.join(stateDir(directory), "jscpd-"));
    try {
      await run("", jscpd.report(directory, output));
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  }
  for (const { workspace, tools, dir, files } of groups) await run(workspace.path, tools.test.related(dir, files), true);
  const blockingPaths = affected ?? changedPaths;
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
