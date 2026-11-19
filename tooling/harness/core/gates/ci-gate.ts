import fs from "node:fs";
import path from "node:path";
import { buildsNext, workspaceOf } from "../../config.ts";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { ALWAYS_BLOCKS, harnessLinted, PRE_EXISTING_HEADING, readLegacy, splitLegacy } from "../classes.ts";
import { untouchedLegacy } from "../legacy.ts";
import { listFiles } from "../audit/list-files.ts";
import { lintConfigFindings } from "../hooks/lint-config-guard.ts";
import { type Applied, appliedUnknown, holdsAppliedMigrations, remoteApplied } from "../hooks/migration-guard.ts";
import { resolveHarness, type Harness } from "../path-check.ts";
import { E2E_TESTS } from "../../presets/e2e.ts";
import { holdsIgnored } from "../state/git-ignore.ts";
import { stateDir } from "../state/state-file.ts";
import { build, electronBuild, playwright, viteBuild } from "../../tools/analysis.ts";
import { toolWorkspaces, workspaceTools } from "../../tools/index.ts";
import { placeStep } from "../../tools/tool-set.ts";
import { startE2eDatabase, type E2eDatabase } from "./e2e-database.ts";
import { analysisSteps, checkSteps, skippedLine, summarizePreExisting, testStep } from "./ci-steps.ts";
import type { GateResult } from "./gate-result.ts";
import { onAppliedMigration } from "./judged-findings.ts";
import { runTool, type SkippedStep, type ToolStep } from "./run-tool.ts";

const APPLIED_HEADING = "Pre-existing in applied migrations (not blocking):";

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
  let pinned: Applied | undefined;
  const applied = (): Applied => (pinned ??= remoteApplied(directory));
  const migration = onAppliedMigration(directory, harness, applied);
  const migrations = new Map<string, Finding[]>();
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
    const forgiven = result.filter(migration);
    if (forgiven.length > 0) {
      migrations.set(name, [...(migrations.get(name) ?? []), ...forgiven]);
      result = result.filter((finding) => !forgiven.includes(finding));
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
    // A tool in a nested folder reads no ignore file above it; with git-ignored files there it is judged file by file.
    const nestedIgnored = workspace.path !== "" && holdsIgnored(directory, workspace.path);
    // An applied migration's finding is forgiven file by file, which an exit code cannot do.
    const perFile = ratchet || nestedIgnored || holdsAppliedMigrations(directory, harness, workspace.path, applied);
    const { format, lint } = checkSteps(group, perFile);
    const { types } = checkSteps(group, ratchet);
    const unknown = appliedUnknown(harness, workspace.path, applied);
    if (unknown !== undefined) reports.push(unknown);
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
  for (const { workspace, dir } of groups.filter((group) => buildsNext(group.workspace))) {
    const tested = fs.globSync(E2E_TESTS, { cwd: dir }).length > 0;
    const config = harness.config.e2eDatabase;
    let database: E2eDatabase | undefined;
    if (tested && config !== undefined) {
      try {
        database = await startE2eDatabase(directory, config);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await record(workspace.path === "" ? "e2e-database" : `e2e-database (${workspace.path})`, () => [{ rule: "e2e-database-failed", file: "", message }]);
        continue;
      }
    }
    // The build reads the same database as the browser tests, since a prerendered page holds its data.
    const env = database === undefined ? {} : { env: database.env };
    try {
      await run(workspace.path, [{ ...build(dir), ...env }]);
      if (tested) await run(workspace.path, [{ ...playwright(dir), ...env }]);
      else reports.push(`${workspace.path === "" ? "playwright" : `playwright (${workspace.path})`}: skipped`);
    } finally {
      await database?.stop();
    }
  }
  for (const { workspace, dir } of groups) {
    if (workspace.shape === "electron-vite") await run(workspace.path, [electronBuild(dir)]);
    if (workspace.shape === "vite-spa") await run(workspace.path, [viteBuild(dir)]);
  }
  const preExisting = [...old.values(), ...migrations.values()].flat();
  if (old.size > 0) reports.push(PRE_EXISTING_HEADING, summarizePreExisting(old));
  if (migrations.size > 0) reports.push(APPLIED_HEADING, summarizePreExisting(migrations));
  return { passed: findings.length === 0, findings, preExisting, report: reports.join("\n") };
}
