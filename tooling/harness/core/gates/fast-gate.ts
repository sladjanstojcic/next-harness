import fs from "node:fs";
import path from "node:path";
import { auditChanged } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { dropUnownedHarnessFindings } from "../classes.ts";
import { isInside, realPath } from "../hooks/shell.ts";
import { isVendoredIn, resolveHarness, type Harness } from "../path-check.ts";
import { isIgnored } from "../state/git-ignore.ts";
import { workspaceTools } from "../../tools/index.ts";
import { placeStep } from "../../tools/tool-set.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool, type ToolStep } from "./run-tool.ts";

export function selectedPaths(root: string, paths: string[], harness: Harness): string[] {
  const selected = new Set<string>();
  for (const file of paths) {
    const absolute = path.resolve(root, file);
    if (!fs.existsSync(absolute)) continue;
    const target = realPath(absolute);
    if (!isInside(root, target) || !fs.statSync(target).isFile()) continue;
    const relative = path.relative(root, target).split(path.sep).join("/");
    const lexical = path.relative(root, absolute).split(path.sep).join("/");
    const vendored = isVendoredIn(harness, relative) || isVendoredIn(harness, lexical);
    if (!vendored && !isIgnored(root, relative) && (!isInside(root, absolute) || !isIgnored(root, lexical))) selected.add(relative);
  }
  return [...selected].sort();
}

/** Runs a step in its workspace folder; a binary found nowhere up to the git root is a finding, or nothing for an optional step. */
export async function runInWorkspace(root: string, workspacePath: string, step: ToolStep, optional = false): Promise<Finding[]> {
  const placed = placeStep(root, workspacePath, step);
  if ("finding" in placed) return optional ? [] : [placed.finding];
  return runTool(root, placed);
}

export async function fastGate(root: string, paths: string[]): Promise<GateResult> {
  const directory = realPath(path.resolve(root));
  const harness = resolveHarness(directory);
  const files = selectedPaths(directory, paths, harness);
  const findings: Finding[] = [];
  if (files.length > 0) {
    for (const { workspace, tools, dir, files: local } of workspaceTools(directory, harness.workspaces, files)) {
      findings.push(...(await runInWorkspace(directory, workspace.path, tools.format.write(dir, local))));
      const sources = local.filter((file) => /\.tsx?$/.test(file));
      if (sources.length > 0) findings.push(...(await runInWorkspace(directory, workspace.path, tools.lint.files(dir, sources, true))));
    }
    findings.push(...auditChanged(directory, files));
  }
  const scoped = dropUnownedHarnessFindings(directory, findings).filter((finding) => finding.file === "" || files.includes(finding.file));
  return { passed: scoped.length === 0, findings: scoped, preExisting: [], report: formatFindings(scoped) };
}
