import fs from "node:fs";
import path from "node:path";
import { analysisOf, workspaceOf } from "../../config.ts";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { harnessLinted, PRE_EXISTING_HEADING, readLegacy, splitLegacy } from "../classes.ts";
import { listFiles } from "../audit/list-files.ts";
import { lintConfigFindings } from "../hooks/lint-config-guard.ts";
import { resolveHarness } from "../path-check.ts";
import { E2E_TESTS } from "../../presets/e2e.ts";
import { build, depcruise, jscpd, knip, playwright } from "../../tools/analysis.ts";
import { toolWorkspaces, workspaceTools } from "../../tools/index.ts";
import { placeStep } from "../../tools/tool-set.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool, type ToolStep } from "./run-tool.ts";

export async function ciGate(root: string): Promise<GateResult> {
  const directory = path.resolve(root);
  const findings: Finding[] = [];
  const reports: string[] = [];
  const harness = resolveHarness(directory);
  /** The shape's advice when every finding (or the step's workspace) has one shape; none when they span shapes. */
  const advice = (result: Finding[], workspacePath: string | undefined): string[] => {
    const files = result.map((finding) => finding.file).filter((file) => file !== "");
    const entries =
      workspacePath !== undefined
        ? harness.workspaces.filter((entry) => entry.path === workspacePath)
        : files.length > 0
          ? files.map((file) => workspaceOf(harness.workspaces, file)?.entry)
          : harness.workspaces;
    const texts = new Set(entries.map((entry) => entry?.shapeImpl.ciAdvice));
    const [text] = texts;
    return texts.size === 1 && text !== undefined ? [text] : [];
  };
  const record = async (name: string, check: () => Finding[] | Promise<Finding[]>, workspacePath?: string): Promise<void> => {
    let result: Finding[];
    try {
      result = await check();
    } catch (error) {
      result = [{ rule: `${name}-failed`, file: "", message: error instanceof Error ? error.message : String(error) }];
    }
    findings.push(...result);
    reports.push(`${name}: ${result.length === 0 ? "passed" : "failed"}`);
    if (result.length > 0) reports.push(formatFindings(result), ...advice(result, workspacePath));
  };
  const groups = toolWorkspaces(directory, harness.workspaces);
  const run = async (workspacePath: string, steps: ToolStep[], optional = false): Promise<void> => {
    for (const step of steps) {
      const placed = placeStep(directory, workspacePath, step);
      const name = workspacePath === "" ? step.name : `${step.name} (${workspacePath})`;
      if (!("finding" in placed)) await record(name, () => runTool(directory, placed), workspacePath);
      else if (optional) reports.push(`${name}: skipped`);
      else await record(name, () => [placed.finding], workspacePath);
    }
  };
  const legacy = readLegacy(directory, harness.config);
  const ownedLint = groups.some(({ tools }) => tools.lint.owned !== undefined);
  const sources = ownedLint
    ? workspaceTools(
        directory,
        harness.workspaces,
        listFiles(directory).filter((file) => /\.tsx?$/.test(file)),
      )
    : [];
  for (const { workspace, tools, dir } of groups) {
    const owned = harnessLinted(harness, legacy, workspace.path, sources.find((group) => group.workspace === workspace)?.files ?? []);
    await run(workspace.path, [
      tools.format.check(dir),
      tools.lint.all(dir),
      ...(tools.lint.owned === undefined || owned.length === 0 ? [] : [tools.lint.owned(dir, owned)]),
      ...(tools.lint.preset === undefined ? [] : [tools.lint.preset(dir, workspace.path, workspace.next)]),
      ...tools.typecheck.all(dir, workspace.next),
    ]);
  }
  const preExisting: Finding[] = [];
  await record("audit", () => {
    const split = splitLegacy(directory, audit(directory));
    preExisting.push(...split.preExisting);
    return [...split.blocking, ...lintConfigFindings(directory, harness)];
  });
  for (const { workspace, dir } of groups) {
    const analysis = new Set(analysisOf(harness.config, workspace));
    await run(workspace.path, [
      ...(analysis.has("depcruise") ? [depcruise.check(dir)] : []),
      ...(analysis.has("knip") ? [knip.check(dir)] : []),
      ...(analysis.has("jscpd") ? [jscpd.check(dir, workspace.path)] : []),
    ]);
  }
  for (const { workspace, tools, dir } of groups) await run(workspace.path, [tools.test.all(dir)], true);
  if (groups.some(({ workspace }) => workspace.path === "" && workspace.next)) {
    await run("", [build(directory)]);
    if (fs.globSync(E2E_TESTS, { cwd: directory }).length > 0) await run("", [playwright(directory)]);
    else reports.push("playwright: skipped");
  }
  if (preExisting.length > 0) reports.push(PRE_EXISTING_HEADING, formatFindings(preExisting));
  return { passed: findings.length === 0, findings, preExisting, report: reports.join("\n") };
}
