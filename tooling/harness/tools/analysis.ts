import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Finding } from "../core/audit/finding.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";
import { bin, CHECK_TIMEOUT_MS, relativePath } from "./tool-set.ts";

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

function dependencyResult(root: string, stdout: string, changed: Set<string>): { findings: Finding[]; affected: Set<string> } {
  const value: unknown = JSON.parse(stdout);
  const result = dependencyOutput.parse(value);
  const installed = installedPackages(root);
  const affected = new Set(changed);
  const dependents = new Map<string, Set<string>>();
  for (const { source, dependencies } of result.modules) {
    const importer = relativePath(root, source);
    for (const dependency of dependencies) {
      if (dependency.coreModule) continue;
      if (dependency.couldNotResolve) {
        const specifier = dependency.resolved;
        const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : (specifier.split("/")[0] ?? "");
        if (specifier.startsWith(".") || specifier.startsWith("@/") || !installed.has(name)) affected.add(importer);
        continue;
      }
      const target = relativePath(root, dependency.resolved);
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
    file: relativePath(root, from),
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
          file: relativePath(root, file),
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
      file: relativePath(root, firstFile.name),
      line: firstFile.start,
      message: `Duplicates ${relativePath(root, secondFile.name)}:${secondFile.start}; share the implementation within the module or in src/shared/lib/.`,
    },
    {
      rule: "jscpd",
      file: relativePath(root, secondFile.name),
      line: secondFile.start,
      message: `Duplicates ${relativePath(root, firstFile.name)}:${firstFile.start}; share the implementation within the module or in src/shared/lib/.`,
    },
  ]);
}

const check = (dir: string, name: string, tool: string, args: string[], timeoutMs = CHECK_TIMEOUT_MS): ToolStep => ({
  name,
  command: [bin(dir, tool), ...args],
  timeoutMs,
  findings: () => [],
});

/** Done reads JSON reports and maps findings to files; CI judges each tool by its exit code. */
export const depcruise = {
  // JSON depcruise exits zero even when its summary contains violations.
  report: (dir: string, changed: Set<string>, onResult: (affected: Set<string>) => void): ToolStep => ({
    name: "depcruise",
    command: [bin(dir, "depcruise"), "src", "--config", ".dependency-cruiser.json", "--output-type", "json"],
    findings: (stdout) => {
      const result = dependencyResult(dir, stdout, changed);
      onResult(result.affected);
      return result.findings;
    },
  }),
  check: (dir: string): ToolStep => check(dir, "depcruise", "depcruise", ["src", "--config", ".dependency-cruiser.json"]),
};

export const knip = {
  report: (dir: string): ToolStep => ({ name: "knip", command: [bin(dir, "knip"), "--reporter", "json"], findings: (stdout) => knipFindings(dir, stdout) }),
  check: (dir: string): ToolStep => check(dir, "knip", "knip", []),
};

export const jscpd = {
  report: (dir: string, output: string): ToolStep => ({
    name: "jscpd",
    command: [
      bin(dir, "jscpd"),
      ...["src", "tooling"].filter((file) => fs.existsSync(path.join(dir, file))),
      "--config",
      ".jscpd.json",
      "--reporters",
      "json",
      "--output",
      output,
      "--absolute",
    ],
    findings: () => duplicateFindings(dir, path.join(output, "jscpd-report.json")),
  }),
  check: (dir: string): ToolStep => check(dir, "jscpd", "jscpd", ["src", "tooling", "--config", ".jscpd.json"]),
};

export const build = (dir: string): ToolStep => check(dir, "build", "next", ["build"], 600_000);

export const playwright = (dir: string): ToolStep => check(dir, "playwright", "playwright", ["test"], 300_000);
