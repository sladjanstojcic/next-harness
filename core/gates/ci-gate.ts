import path from "node:path";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { PRE_EXISTING_HEADING, splitLegacy } from "../classes.ts";
import { resolveHarness } from "../path-check.ts";
import { build, depcruise, jscpd, knip, playwright } from "../../tools/analysis.ts";
import { rootTools } from "../../tools/index.ts";
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
  const workspace = rootTools(resolveHarness(directory).workspaces);
  const run = async (steps: ToolStep[]): Promise<void> => {
    for (const step of steps) await record(step.name, () => runTool(directory, step));
  };
  if (workspace) {
    const { tools, next } = workspace;
    await run([tools.format.check(directory), tools.lint.all(directory), ...tools.typecheck.all(directory, next)]);
  }
  const preExisting: Finding[] = [];
  await record("audit", () => {
    const split = splitLegacy(directory, audit(directory));
    preExisting.push(...split.preExisting);
    return split.blocking;
  });
  if (workspace)
    await run([
      depcruise.check(directory),
      knip.check(directory),
      jscpd.check(directory),
      workspace.tools.test.all(directory),
      build(directory),
      playwright(directory),
    ]);
  if (preExisting.length > 0) reports.push(PRE_EXISTING_HEADING, formatFindings(preExisting));
  return { passed: findings.length === 0, findings, preExisting, report: reports.join("\n") };
}
