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
import { rootTools } from "../../tools/index.ts";
import { relativePath } from "../../tools/tool-set.ts";
import { selectedPaths } from "./fast-gate.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool, type ToolStep } from "./run-tool.ts";

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
  const workspace = rootTools(harness.workspaces);
  let affected: Set<string> | undefined;
  const all: Finding[] = [];
  const run = async (step: ToolStep): Promise<void> => {
    all.push(...(await runTool(directory, step)));
  };
  if (workspace !== undefined) {
    const { tools, next } = workspace;
    const sources = selectedPaths(directory, changed, harness).filter((file) => /\.tsx?$/.test(file));
    for (const step of tools.typecheck.incremental(directory, next)) await run(step);
    if (sources.length > 0) await run(tools.lint.files(directory, sources, false));
  }
  all.push(
    ...audit(directory),
    ...lockFindings(directory, changedPaths, harness.config),
    ...legacyAppendFindings(directory, harness.config),
    ...legacyInvalidFindings(directory, harness.config),
  );
  if (workspace !== undefined) {
    await run(
      depcruise.report(directory, changedPaths, (result) => {
        affected = result;
      }),
    );
    await run(knip.report(directory));
    const output = fs.mkdtempSync(path.join(stateDir(directory), "jscpd-"));
    try {
      await run(jscpd.report(directory, output));
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
    await run(workspace.tools.test.related(directory, [...changedPaths]));
  }
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
