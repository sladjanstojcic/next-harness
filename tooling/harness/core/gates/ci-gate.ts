import path from "node:path";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { PRE_EXISTING_HEADING, splitLegacy } from "../classes.ts";
import { resolveHarness } from "../path-check.ts";
import { build, depcruise, jscpd, knip, playwright } from "../../tools/analysis.ts";
import { toolWorkspaces } from "../../tools/index.ts";
import { placeStep } from "../../tools/tool-set.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool, type ToolStep } from "./run-tool.ts";

export async function ciGate(root: string): Promise<GateResult> {
  const directory = path.resolve(root);
  const findings: Finding[] = [];
  const reports: string[] = [];
  const record = async (name: string, check: () => Finding[] | Promise<Finding[]>): Promise<void> => {
    let result: Finding[];
    try {
      result = await check();
    } catch (error) {
      result = [{ rule: `${name}-failed`, file: "", message: error instanceof Error ? error.message : String(error) }];
    }
    findings.push(...result);
    reports.push(`${name}: ${result.length === 0 ? "passed" : "failed"}`);
    if (result.length > 0)
      reports.push(
        formatFindings(result),
        "Fix application code in src/modules/ or src/shared/; harness code belongs in tooling/harness/ and automation in scripts/.",
      );
  };
  const harness = resolveHarness(directory);
  const groups = toolWorkspaces(directory, harness.workspaces);
  const analysis = new Set(harness.config.analysis ?? []);
  const run = async (workspacePath: string, steps: ToolStep[], optional = false): Promise<void> => {
    for (const step of steps) {
      const placed = placeStep(directory, workspacePath, step);
      const name = workspacePath === "" ? step.name : `${step.name} (${workspacePath})`;
      if (!("finding" in placed)) await record(name, () => runTool(directory, placed));
      else if (optional) reports.push(`${name}: skipped`);
      else await record(name, () => [placed.finding]);
    }
  };
  for (const { workspace, tools, dir } of groups)
    await run(workspace.path, [tools.format.check(dir), tools.lint.all(dir), ...tools.typecheck.all(dir, workspace.next)]);
  const preExisting: Finding[] = [];
  await record("audit", () => {
    const split = splitLegacy(directory, audit(directory));
    preExisting.push(...split.preExisting);
    return split.blocking;
  });
  await run("", [
    ...(analysis.has("depcruise") ? [depcruise.check(directory)] : []),
    ...(analysis.has("knip") ? [knip.check(directory)] : []),
    ...(analysis.has("jscpd") ? [jscpd.check(directory)] : []),
  ]);
  for (const { workspace, tools, dir } of groups) await run(workspace.path, [tools.test.all(dir)], true);
  if (groups.some(({ workspace }) => workspace.path === "" && workspace.next)) await run("", [build(directory), playwright(directory)]);
  if (preExisting.length > 0) reports.push(PRE_EXISTING_HEADING, formatFindings(preExisting));
  return { passed: findings.length === 0, findings, preExisting, report: reports.join("\n") };
}
