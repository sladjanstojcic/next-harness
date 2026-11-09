import path from "node:path";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool } from "./run-tool.ts";

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
  const run = (name: string, tool: string, args: string[], timeoutMs = 120_000): Promise<void> =>
    record(name, () => runTool(directory, { name, command: [path.join(directory, "node_modules/.bin", tool), ...args], timeoutMs, findings: () => [] }));
  await run("prettier", "prettier", ["--check", "."]);
  await run("eslint", "eslint", [".", "--max-warnings", "0"]);
  await run("typegen", "next", ["typegen"]);
  await run("tsc", "tsc", ["--noEmit"]);
  await record("audit", () => audit(directory));
  await run("depcruise", "depcruise", ["src", "--config", ".dependency-cruiser.json"]);
  await run("knip", "knip", []);
  await run("jscpd", "jscpd", ["src", "tooling", "--config", ".jscpd.json"]);
  await run("vitest", "vitest", ["run"], 600_000);
  await run("build", "next", ["build"], 600_000);
  await run("playwright", "playwright", ["test"], 300_000);
  return { passed: findings.length === 0, findings, preExisting: [], report: reports.join("\n") };
}
