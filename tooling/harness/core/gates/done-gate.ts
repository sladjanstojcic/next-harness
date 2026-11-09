import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { audit } from "../audit/audit.ts";
import { formatFindings, type Finding } from "../audit/finding.ts";
import { ALWAYS_BLOCKS, classify, HARNESS_RULES, legacyInvalidFindings, readLegacy, type PathClass } from "../classes.ts";
import { realPath } from "../hooks/shell.ts";
import { legacyAppendFindings } from "../legacy.ts";
import { lockFindings } from "../lock.ts";
import { resolveHarness } from "../path-check.ts";
import { withGateLock } from "../state/run-lock.ts";
import { stateDir } from "../state/state-file.ts";
import { eslintFindings, selectedPaths } from "./fast-gate.ts";
import type { GateResult } from "./gate-result.ts";
import { runTool, type ToolStep } from "./run-tool.ts";

const dependencyOutput = z.object({
  modules: z.array(
    z.object({
      source: z.string(),
      dependencies: z.array(
        z.object({
          resolved: z.string(),
          couldNotResolve: z.boolean(),
          coreModule: z.boolean(),
        }),
      ),
    }),
  ),
  summary: z.object({
    violations: z.array(
      z.object({
        rule: z.object({ name: z.string(), comment: z.string().optional() }),
        from: z.string(),
        to: z.string(),
      }),
    ),
  }),
});
const knipOutput = z.object({ issues: z.array(z.object({ file: z.string() }).catchall(z.array(z.unknown()))) });
const duplicateFile = z.object({ name: z.string(), start: z.number() });
const duplicateOutput = z.object({ duplicates: z.array(z.object({ firstFile: duplicateFile, secondFile: duplicateFile })) });
const declarations = z.record(z.string(), z.string()).optional();
const packageOutput = z.object({
  dependencies: declarations,
  devDependencies: declarations,
  peerDependencies: declarations,
  optionalDependencies: declarations,
});

function installedPackages(root: string): Set<string> {
  const value: unknown = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return new Set(
    Object.values(packageOutput.parse(value))
      .flatMap((group) => Object.keys(group ?? {}))
      .filter((name) => fs.existsSync(path.join(root, "node_modules", name, "package.json"))),
  );
}

function relative(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
}

function typeFindings(root: string, stdout: string): Finding[] {
  return stdout.split(/\r?\n/).flatMap((line): Finding[] => {
    const match = /^(.*?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (!match) return /^error TS\d+:/.test(line) ? [{ rule: "tsc-failed", file: "", message: line }] : [];
    return [{ file: relative(root, match[1] ?? ""), line: Number(match[2]), rule: match[3] ?? "tsc", message: match[4] ?? line }];
  });
}

function dependencyResult(root: string, stdout: string, changed: Set<string>): { findings: Finding[]; affected: Set<string> } {
  const value: unknown = JSON.parse(stdout);
  const result = dependencyOutput.parse(value);
  const installed = installedPackages(root);
  const affected = new Set(changed);
  const dependents = new Map<string, Set<string>>();
  for (const { source, dependencies } of result.modules) {
    const importer = relative(root, source);
    for (const dependency of dependencies) {
      if (dependency.coreModule) continue;
      if (dependency.couldNotResolve) {
        const specifier = dependency.resolved;
        const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : (specifier.split("/")[0] ?? "");
        if (specifier.startsWith(".") || specifier.startsWith("@/") || !installed.has(name)) affected.add(importer);
        continue;
      }
      const target = relative(root, dependency.resolved);
      const importers = dependents.get(target) ?? new Set<string>();
      importers.add(importer);
      dependents.set(target, importers);
    }
  }
  // Set iteration visits newly added importers too; each path is visited once, including cycles.
  for (const file of affected) {
    for (const importer of dependents.get(file) ?? []) affected.add(importer);
  }
  const findings = result.summary.violations.map(({ rule, from, to }) => ({
    rule: rule.name,
    file: relative(root, from),
    message: `${from} → ${to}. ${rule.comment ?? "Keep imports within the module or use its public API; cross-cutting code belongs in src/shared/lib/."}`,
  }));
  return { findings, affected };
}

function knipFindings(root: string, stdout: string): Finding[] {
  const value: unknown = JSON.parse(stdout);
  const unusedDependency = "Remove the unused dependency from package.json or use it in the application.";
  const guidance: Record<string, string> = {
    files: "Remove the unused file or import it from an entry point.",
    exports: "Remove the unused export or import it where it is used.",
    dependencies: unusedDependency,
    devDependencies: unusedDependency,
  };
  return knipOutput.parse(value).issues.flatMap(({ file, ...issues }) =>
    Object.entries(issues)
      .filter(([kind]) => kind !== "owners")
      .flatMap(([kind, entries]) =>
        entries.map((entry): Finding => ({
          rule: `knip-${kind}`,
          file: relative(root, file),
          message: `${kind}: ${JSON.stringify(entry)}. ${guidance[kind] ?? `Resolve the ${kind} issue in ${file}.`}`,
        })),
      ),
  );
}

function duplicateFindings(root: string, reportFile: string): Finding[] {
  const value: unknown = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  return duplicateOutput.parse(value).duplicates.flatMap(({ firstFile, secondFile }) => [
    {
      rule: "jscpd",
      file: relative(root, firstFile.name),
      line: firstFile.start,
      message: `Duplicates ${relative(root, secondFile.name)}:${secondFile.start}; share the implementation within the module or in src/shared/lib/.`,
    },
    {
      rule: "jscpd",
      file: relative(root, secondFile.name),
      line: secondFile.start,
      message: `Duplicates ${relative(root, firstFile.name)}:${firstFile.start}; share the implementation within the module or in src/shared/lib/.`,
    },
  ]);
}

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
  const changedPaths = new Set(changed.map((file) => relative(directory, file)));
  const dependencies: { result?: ReturnType<typeof dependencyResult> } = {};
  const sources = selectedPaths(directory, changed).filter((file) => /\.tsx?$/.test(file));
  const all: Finding[] = [];
  const run = async (name: string, args: string[], findings: ToolStep["findings"]): Promise<void> => {
    all.push(...(await runTool(directory, { name, command: [path.join(directory, "node_modules/.bin", name), ...args], findings })));
  };
  await run("next", ["typegen"], () => []);
  await run("tsc", ["--noEmit", "--incremental", "--pretty", "false"], (stdout) => typeFindings(directory, stdout));
  if (sources.length > 0) await run("eslint", ["--format", "json", "--no-warn-ignored", "--", ...sources], (stdout) => eslintFindings(directory, stdout));
  const harness = resolveHarness(directory);
  const legacy = readLegacy(directory, harness.config);
  all.push(
    ...audit(directory),
    ...lockFindings(directory, changedPaths, harness.config),
    ...legacyAppendFindings(directory, harness.config),
    ...legacyInvalidFindings(directory, harness.config),
  );
  // JSON depcruise exits zero even when its summary contains violations.
  await run("depcruise", ["src", "--config", ".dependency-cruiser.json", "--output-type", "json"], (stdout) => {
    dependencies.result = dependencyResult(directory, stdout, changedPaths);
    return dependencies.result.findings;
  });
  const blockingPaths = dependencies.result?.affected ?? changedPaths;
  await run("knip", ["--reporter", "json"], (stdout) => knipFindings(directory, stdout));
  const output = fs.mkdtempSync(path.join(stateDir(directory), "jscpd-"));
  try {
    const targets = ["src", "tooling"].filter((file) => fs.existsSync(path.join(directory, file)));
    await run("jscpd", [...targets, "--config", ".jscpd.json", "--reporters", "json", "--output", output, "--absolute"], () =>
      duplicateFindings(directory, path.join(output, "jscpd-report.json")),
    );
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
  await run("vitest", ["related", "--run", "--passWithNoTests", ...changedPaths], () => []);
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
