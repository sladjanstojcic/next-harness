import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { auditChanged } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { dropUnownedHarnessFindings } from "../classes.ts";
import { isInside, realPath } from "../hooks/shell.ts";
import { isIgnored } from "../state/git-ignore.ts";
import { isVendored } from "../../shapes/next-modules.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool } from "./run-tool.ts";

const lintOutput = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        ruleId: z.string().nullable(),
        severity: z.number(),
        message: z.string(),
        line: z.number().optional(),
      }),
    ),
  }),
);

export function selectedPaths(root: string, paths: string[]): string[] {
  const selected = new Set<string>();
  for (const file of paths) {
    const absolute = path.resolve(root, file);
    if (!fs.existsSync(absolute)) continue;
    const target = realPath(absolute);
    if (!isInside(root, target) || !fs.statSync(target).isFile()) continue;
    const relative = path.relative(root, target).split(path.sep).join("/");
    const lexical = path.relative(root, absolute).split(path.sep).join("/");
    if (!isVendored(relative) && !isVendored(lexical) && !isIgnored(root, relative) && (!isInside(root, absolute) || !isIgnored(root, lexical)))
      selected.add(relative);
  }
  return [...selected].sort();
}

export function eslintFindings(root: string, stdout: string): Finding[] {
  const parsed: unknown = JSON.parse(stdout);
  return lintOutput.parse(parsed).flatMap((result) =>
    result.messages
      .filter((message) => message.severity > 0)
      .map((message): Finding => ({
        rule: message.ruleId ?? "eslint",
        file: path.relative(root, result.filePath).split(path.sep).join("/"),
        ...(message.line === undefined ? {} : { line: message.line }),
        message: message.message,
      })),
  );
}

export async function fastGate(root: string, paths: string[]): Promise<GateResult> {
  const directory = realPath(path.resolve(root));
  const files = selectedPaths(directory, paths);
  const findings: Finding[] = [];
  if (files.length > 0) {
    findings.push(
      ...(await runTool(directory, {
        name: "prettier",
        command: [path.join(directory, "node_modules/.bin/prettier"), "--write", "--ignore-unknown", "--", ...files],
        findings: () => [],
      })),
    );
    const sources = files.filter((file) => /\.tsx?$/.test(file));
    if (sources.length > 0)
      findings.push(
        ...(await runTool(directory, {
          name: "eslint",
          command: [
            "/usr/bin/env",
            "HARNESS_FAST_LINT=1",
            path.join(directory, "node_modules/.bin/eslint"),
            "--format",
            "json",
            "--no-warn-ignored",
            "--",
            ...sources,
          ],
          findings: (stdout) => eslintFindings(directory, stdout),
        })),
      );
    findings.push(...auditChanged(directory, files));
  }
  const scoped = dropUnownedHarnessFindings(directory, findings).filter((finding) => finding.file === "" || files.includes(finding.file));
  return { passed: scoped.length === 0, findings: scoped, preExisting: [], report: formatFindings(scoped) };
}
