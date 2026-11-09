import fs from "node:fs";
import path from "node:path";
import { auditChanged } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { dropUnownedHarnessFindings } from "../classes.ts";
import { isInside, realPath } from "../hooks/shell.ts";
import { isVendoredIn, resolveHarness, type Harness } from "../path-check.ts";
import { isIgnored } from "../state/git-ignore.ts";
import { rootTools } from "../../tools/index.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool } from "./run-tool.ts";

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

export async function fastGate(root: string, paths: string[]): Promise<GateResult> {
  const directory = realPath(path.resolve(root));
  const harness = resolveHarness(directory);
  const files = selectedPaths(directory, paths, harness);
  const workspace = rootTools(harness.workspaces);
  const findings: Finding[] = [];
  if (files.length > 0) {
    if (workspace !== undefined) {
      findings.push(...(await runTool(directory, workspace.tools.format.write(directory, files))));
      const sources = files.filter((file) => /\.tsx?$/.test(file));
      if (sources.length > 0) findings.push(...(await runTool(directory, workspace.tools.lint.files(directory, sources, true))));
    }
    findings.push(...auditChanged(directory, files));
  }
  const scoped = dropUnownedHarnessFindings(directory, findings).filter((finding) => finding.file === "" || files.includes(finding.file));
  return { passed: scoped.length === 0, findings: scoped, preExisting: [], report: formatFindings(scoped) };
}
