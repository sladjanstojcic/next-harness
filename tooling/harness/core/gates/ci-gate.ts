import fs from "node:fs";
import path from "node:path";
import { workspaceOf } from "../../config.ts";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { ALWAYS_BLOCKS, harnessLinted, PRE_EXISTING_HEADING, readLegacy, splitLegacy } from "../classes.ts";
import { untouchedLegacy } from "../legacy.ts";
import { listFiles } from "../audit/list-files.ts";
import { lintConfigFindings } from "../hooks/lint-config-guard.ts";
import { resolveHarness, type Harness } from "../path-check.ts";
import { E2E_TESTS } from "../../presets/e2e.ts";
import { stateDir } from "../state/state-file.ts";
import { build, playwright } from "../../tools/analysis.ts";
import { toolWorkspaces, workspaceTools } from "../../tools/index.ts";
import { placeStep } from "../../tools/tool-set.ts";
import { analysisSteps, checkSteps, skippedLine, summarizePreExisting, testStep, type SkippedStep } from "./ci-steps.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool, type ToolStep } from "./run-tool.ts";

export async function ciGate(root: string): Promise<GateResult> {
  const directory = path.resolve(root);
  const harness = resolveHarness(directory);
  // A legacy list makes CI judge tool findings file by file; without one every step is judged by its exit code, as before.
  if (harness.config.legacy === undefined) return runCiGate(directory, harness, false, "");
  const output = fs.mkdtempSync(path.join(stateDir(directory), "jscpd-"));
  try {
    return await runCiGate(directory, harness, true, output);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

async function runCiGate(directory: string, harness: Harness, ratchet: boolean, output: string): Promise<GateResult> {
  const findings: Finding[] = [];
  const reports: string[] = [];
  const legacy = readLegacy(directory, harness.config);
  const base = ratchet ? untouchedLegacy(directory, legacy) : { files: new Set<string>(), findings: [] };
  const untouched = base.files;
  const old = new Map<string, Finding[]>();
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
    // The ratchet: a tool finding on a legacy file nobody touched is old debt, reported once at the end.
    const tolerated = result.filter((finding) => untouched.has(finding.file) && !ALWAYS_BLOCKS(finding));
    if (tolerated.length > 0) {
      old.set(name, [...(old.get(name) ?? []), ...tolerated]);
      result = result.filter((finding) => !tolerated.includes(finding));
    }
    findings.push(...result);
    reports.push(`${name}: ${result.length === 0 ? "passed" : "failed"}`);
    if (result.length > 0) reports.push(formatFindings(result), ...advice(result, workspacePath));
  };
  if (base.findings.length > 0) await record("legacy-base", () => base.findings);
  const groups = toolWorkspaces(directory, harness.workspaces);
  const run = async (workspacePath: string, steps: (ToolStep | SkippedStep)[], optional = false): Promise<void> => {
    for (const step of steps) {
      if ("skipped" in step) {
        reports.push(skippedLine(step.name, workspacePath, step.skipped));
        continue;
      }
      const placed = placeStep(directory, workspacePath, step);
      const name = workspacePath === "" ? step.name : `${step.name} (${workspacePath})`;
      if (!("finding" in placed)) await record(name, () => runTool(directory, placed), workspacePath);
      else if (optional) reports.push(`${name}: skipped`);
      else await record(name, () => [placed.finding], workspacePath);
    }
  };
  const ownedLint = groups.some(({ tools }) => tools.lint.owned !== undefined);
  const sources = ownedLint
    ? workspaceTools(
        directory,
        harness.workspaces,
        listFiles(directory).filter((file) => /\.tsx?$/.test(file)),
      )
    : [];
  for (const group of groups) {
    const { workspace, tools, dir } = group;
    const owned = harnessLinted(harness, legacy, workspace.path, sources.find((found) => found.workspace === workspace)?.files ?? []);
    const { format, lint, types } = checkSteps(group, ratchet);
    await run(workspace.path, [
      format,
      lint,
      ...(tools.lint.owned === undefined || owned.length === 0 ? [] : [tools.lint.owned(dir, owned)]),
      ...(tools.lint.preset === undefined ? [] : [tools.lint.preset(dir, workspace)]),
      ...types,
    ]);
  }
  await record("audit", () => {
    const split = splitLegacy(directory, audit(directory));
    if (split.preExisting.length > 0) old.set("audit", split.preExisting);
    return [...split.blocking, ...lintConfigFindings(directory, harness)];
  });
  for (const group of groups) await run(group.workspace.path, analysisSteps(directory, harness, group, ratchet, output));
  for (const group of groups) await run(group.workspace.path, [testStep(directory, group)], true);
  if (groups.some(({ workspace }) => workspace.path === "" && workspace.next)) {
    await run("", [build(directory)]);
    if (fs.globSync(E2E_TESTS, { cwd: directory }).length > 0) await run("", [playwright(directory)]);
    else reports.push("playwright: skipped");
  }
  const preExisting = [...old.values()].flat();
  if (preExisting.length > 0) reports.push(PRE_EXISTING_HEADING, summarizePreExisting(old));
  return { passed: findings.length === 0, findings, preExisting, report: reports.join("\n") };
}
