import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { sourcePaths, sourceRootOf, type WorkspaceEntry } from "../config.ts";
import type { Finding } from "../core/audit/finding.ts";
import { ALL_NAMES } from "../core/package-usage.ts";
import { shapeOf } from "../shapes/index.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";
import { presetImport } from "./eslint-preset.ts";
import { bin, CHECK_TIMEOUT_MS, relativePath } from "./tool-set.ts";
import { cruiserAliases } from "./typescript.ts";

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
    ruleSetUsed: z.object({ forbidden: z.array(z.object({ name: z.string(), comment: z.string().optional() })).optional() }).optional(),
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

function dependencyResult(root: string, workspace: WorkspaceEntry, stdout: string, changed: Set<string>): { findings: Finding[]; affected: Set<string> } {
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
  // The preset's comments name src/ paths; a workspace without src/ reads them with its own.
  const advice = (comment = "Keep imports within the module or use its public API; cross-cutting code belongs in src/shared/lib/."): string =>
    sourceRootOf(workspace) === "" ? comment.replaceAll("src/", "") : comment;
  // A violation names its rule without the rule's comment; the Electron preset's comments say which part may import what.
  const rules = workspace.shape === "electron-vite" ? (result.summary.ruleSetUsed?.forbidden ?? []) : [];
  const comments = new Map(rules.map(({ name, comment }) => [name, comment]));
  const findings = result.summary.violations.map(({ rule, from, to }) => ({
    rule: rule.name,
    file: relativePath(root, from),
    message: `${from} → ${to}. ${advice(rule.comment ?? comments.get(rule.name))}`,
  }));
  return { findings, affected };
}

/** What each kind of knip issue is, in words; the entry's name follows. */
const KNIP_KINDS: Readonly<Record<string, string>> = {
  files: "unused file",
  exports: "unused export",
  types: "unused exported type",
  dependencies: "unused dependency",
  devDependencies: "unused devDependency",
  binaries: "unlisted binary",
  unlisted: "unlisted dependency",
  unresolved: "unresolved import",
};
const knipEntry = z.object({ name: z.string(), line: z.number().optional() });

/** Entry file to the names another workspace imports from it; see core/package-usage.ts. */
type UsedElsewhere = ReadonlyMap<string, ReadonlySet<string>>;

function knipFindings(root: string, stdout: string, usedElsewhere?: () => UsedElsewhere): Finding[] {
  // Knip names an unused public export in the file that defines it, not in the entry that re-exports it, so a name
  // another workspace imports from any entry counts wherever the package exports it.
  const used = new Set([...(usedElsewhere?.() ?? new Map<string, ReadonlySet<string>>()).values()].flatMap((names) => [...names]));
  const isUsed = (kind: string, name: string): boolean => (kind === "exports" || kind === "types") && (used.has(name) || used.has(ALL_NAMES));
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
        entries.flatMap((entry): Finding[] => {
          const named = knipEntry.safeParse(entry);
          if (named.success && isUsed(kind, named.data.name)) return [];
          const what = `${KNIP_KINDS[kind] ?? kind}${named.success ? ` ${named.data.name}` : `: ${JSON.stringify(entry)}`}`;
          const finding: Finding = {
            rule: `knip-${kind}`,
            file: relativePath(root, file),
            ...(named.success && named.data.line !== undefined ? { line: named.data.line } : {}),
            message: `${what}. ${guidance[kind] ?? `Resolve the ${kind} issue in ${file}.`}`,
          };
          return [finding];
        }),
      ),
  );
}

function duplicateFindings(root: string, shared: string, reportFile: string): Finding[] {
  const value: unknown = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  return duplicateOutput.parse(value).duplicates.flatMap(({ firstFile, secondFile }) => [
    {
      rule: "jscpd",
      file: relativePath(root, firstFile.name),
      line: firstFile.start,
      message: `Duplicates ${relativePath(root, secondFile.name)}:${secondFile.start}; share the implementation within the module or in ${shared}.`,
    },
    {
      rule: "jscpd",
      file: relativePath(root, secondFile.name),
      line: secondFile.start,
      message: `Duplicates ${relativePath(root, firstFile.name)}:${firstFile.start}; share the implementation within the module or in ${shared}.`,
    },
  ]);
}

const check = (dir: string, name: string, tool: string, args: string[], timeoutMs = CHECK_TIMEOUT_MS): ToolStep => ({
  name,
  command: [bin(dir, tool), ...args],
  timeoutMs,
  findings: () => [],
});

const sharedLib = (workspace: WorkspaceEntry): string =>
  `${shapeOf(workspace.shape, sourceRootOf(workspace)).moduleRoot ?? sourceRootOf(workspace)}shared/lib/`;
/** What depcruise and jscpd read: src/, or the areas and the files beside app/ that exist at the top of a workspace without src/. */
const sources = (dir: string, workspace: WorkspaceEntry): string[] => (sourceRootOf(workspace) === "" ? sourcePaths(dir, "") : ["src"]);

const cruised = (dir: string, workspace: WorkspaceEntry): string[] => [
  ...sources(dir, workspace),
  "--config",
  ".dependency-cruiser.json",
  ...cruiserAliases(dir, workspace),
];
/** Done reads JSON reports and maps findings to files; CI judges each tool by its exit code. */
export const depcruise = {
  // JSON depcruise exits zero even when its summary contains violations.
  report: (dir: string, workspace: WorkspaceEntry, changed: Set<string>, onResult: (affected: Set<string>) => void): ToolStep => ({
    name: "depcruise",
    command: [bin(dir, "depcruise"), ...cruised(dir, workspace), "--output-type", "json"],
    findings: (stdout) => {
      const result = dependencyResult(dir, workspace, stdout, changed);
      onResult(result.affected);
      return result.findings;
    },
  }),
  check: (dir: string, workspace: WorkspaceEntry): ToolStep => check(dir, "depcruise", "depcruise", cruised(dir, workspace)),
};

export const knip = {
  report: (dir: string): ToolStep => ({ name: "knip", command: [bin(dir, "knip"), "--reporter", "json"], findings: (stdout) => knipFindings(dir, stdout) }),
  /**
   * A package: knip reports every unused export of its entry files, and the gate takes out those another workspace
   * imports. The exit code then says nothing, so knip is asked not to set one; a crash still fails the parser.
   */
  package: (dir: string, usedElsewhere: () => UsedElsewhere): ToolStep => ({
    name: "knip",
    command: [bin(dir, "knip"), "--reporter", "json", "--no-exit-code"],
    findings: (stdout) => knipFindings(dir, stdout, usedElsewhere),
  }),
  check: (dir: string): ToolStep => check(dir, "knip", "knip", []),
};

/** Where an Electron project's jscpd report goes: a folder every project ignores, since it has no .next/ for the preset's. */
export const JSCPD_CACHE = "node_modules/.cache/jscpd";

/** The workspace's own .jscpd.json, or the harness preset; jscpd has no `extends`. */
function jscpdConfig(dir: string, workspacePath: string): string {
  return fs.existsSync(path.join(dir, ".jscpd.json")) ? ".jscpd.json" : presetImport(workspacePath, "jscpd.json");
}

export const jscpd = {
  report: (dir: string, output: string, workspace: WorkspaceEntry): ToolStep => ({
    name: "jscpd",
    command: [
      bin(dir, "jscpd"),
      ...[...sources(dir, workspace), "tooling"].filter((file) => fs.existsSync(path.join(dir, file))),
      "--config",
      jscpdConfig(dir, workspace.path),
      "--reporters",
      "json",
      "--output",
      output,
      "--absolute",
    ],
    findings: () => duplicateFindings(dir, sharedLib(workspace), path.join(output, "jscpd-report.json")),
  }),
  check: (dir: string, workspace: WorkspaceEntry): ToolStep => {
    const folders =
      sourceRootOf(workspace) === "" ? [...sources(dir, workspace), "tooling"].filter((file) => fs.existsSync(path.join(dir, file))) : ["src", "tooling"];
    const output = workspace.shape === "electron-vite" ? ["--output", JSCPD_CACHE] : [];
    return check(dir, "jscpd", "jscpd", [...folders, "--config", jscpdConfig(dir, workspace.path), ...output]);
  },
};

export const build = (dir: string): ToolStep => check(dir, "build", "next", ["build"], 600_000);

/** An Electron app's production build of main, preload and renderer; packaging with electron-builder is the user's step. */
export const electronBuild = (dir: string): ToolStep => check(dir, "build", "electron-vite", ["build"], 600_000);

export const playwright = (dir: string): ToolStep => check(dir, "playwright", "playwright", ["test"], 300_000);
