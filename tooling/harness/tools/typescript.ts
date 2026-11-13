import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ShapeName, WorkspaceEntry } from "../config.ts";
import type { Finding } from "../core/audit/finding.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";
import { electronAliases, type ElectronAliases } from "../presets/electron-aliases.ts";
import { bin, CHECK_TIMEOUT_MS, relativePath } from "./tool-set.ts";

export { ts };

/** A tsconfig with every file it extends: its compiler options, and whether it names no file to check by itself. */
export interface TsconfigInForce {
  options: ts.CompilerOptions;
  /** `"files": []` and no `include`: the solution style, whose own `tsc` run checks nothing. */
  checksNothing: boolean;
  /** The tsconfig file of each project it refers to. */
  references: string[];
}

/**
 * Reads a tsconfig without listing the project's files. Undefined when the file or one it extends cannot be read:
 * `tsc` then reports that itself.
 */
export function tsconfigInForce(file: string): TsconfigInForce | undefined {
  const host = { ...ts.sys, readDirectory: () => [], onUnRecoverableConfigFileDiagnostic: () => undefined };
  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, host);
  // No file is listed on purpose, so "no inputs" and "the files list is empty" say nothing about the config.
  const EXPECTED = [18002, 18003];
  if (parsed === undefined || parsed.errors.some((error) => !EXPECTED.includes(error.code))) return undefined;
  const raw: unknown = parsed.raw;
  const own = typeof raw === "object" && raw !== null ? raw : {};
  const files = "files" in own ? own.files : undefined;
  return {
    options: parsed.options,
    checksNothing: Array.isArray(files) && files.length === 0 && !("include" in own && own.include !== undefined),
    references: (parsed.projectReferences ?? []).map((reference) => ts.resolveProjectReferencePath(reference)),
  };
}

/** Whether a shape's tsconfig.json refers to the projects that hold its files and aliases, as electron-vite and create-vite write it. */
export const checksByProject = (shape: ShapeName): boolean => shape === "electron-vite" || shape === "vite-spa";

/**
 * An electron-vite or vite-spa workspace's tsconfig.json names no file itself: its type check is that of each project it
 * refers to, as paths from the workspace folder. Every other workspace is checked through its tsconfig.json alone.
 */
export function typecheckProjects(dir: string, workspace: Pick<WorkspaceEntry, "shape">): string[] {
  if (!checksByProject(workspace.shape)) return [];
  const config = tsconfigInForce(path.join(dir, "tsconfig.json"));
  return config?.checksNothing === true ? config.references.map((file) => relativePath(dir, file)) : [];
}

/** The aliases an electron-vite workspace declares, in its tsconfig.json or in a project that file refers to. */
export const aliasesOf = (dir: string): ElectronAliases => electronAliases(ts, dir);

/**
 * dependency-cruiser reads one tsconfig for aliases, and a solution-style tsconfig.json often holds none: this writes one
 * that extends it and carries every alias in force, into a folder git ignores, and returns the arguments that name it.
 */
export function cruiserAliases(dir: string, workspace: Pick<WorkspaceEntry, "shape">): string[] {
  const { paths } = checksByProject(workspace.shape) ? aliasesOf(dir) : { paths: {} };
  if (Object.keys(paths).length === 0) return [];
  const file = path.join(dir, "node_modules/.cache/harness/tsconfig.aliases.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ extends: path.join(dir, "tsconfig.json"), compilerOptions: { paths } }, null, 2)}\n`);
  return ["--ts-config", relativePath(dir, file)];
}

/** The files a tsconfig takes through `files` and `include`, as absolute paths; none when it cannot be read. */
export function tsconfigFiles(file: string): string[] {
  return ts.getParsedCommandLineOfConfigFile(file, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })?.fileNames ?? [];
}

/** Runs tsc once per project and fails when one of them does; the shell only loops, every argument is passed as one word. */
const EACH_PROJECT = 'tsc=$1; flags=$2; shift 2; status=0; for project; do "$tsc" --noEmit $flags -p "$project" || status=1; done; exit $status';

function tscCommand(dir: string, flags: readonly string[], projects: readonly string[]): string[] {
  if (projects.length === 0) return [bin(dir, "tsc"), "--noEmit", ...flags];
  return ["/bin/sh", "-c", EACH_PROJECT, "sh", bin(dir, "tsc"), flags.join(" "), ...projects];
}

export const compilerOptionsInForce = (file: string): ts.CompilerOptions | undefined => tsconfigInForce(file)?.options;

function typeFindings(root: string, stdout: string): Finding[] {
  // Two projects that both include a file print its errors once each: a line is read once.
  return [...new Set(stdout.split(/\r?\n/))].flatMap((line): Finding[] => {
    const match = /^(.*?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (!match) return /^error TS\d+:/.test(line) ? [{ rule: "tsc-failed", file: "", message: line }] : [];
    return [{ file: relativePath(root, match[1] ?? ""), line: Number(match[2]), rule: match[3] ?? "tsc", message: match[4] ?? line }];
  });
}

/** Done: Next type generation first when the workspace is a Next app, then incremental tsc with parsed findings. */
export function incrementalTypecheck(dir: string, next: boolean, projects: readonly string[] = []): ToolStep[] {
  const tsc: ToolStep = {
    name: "tsc",
    command: tscCommand(dir, ["--incremental", "--pretty", "false"], projects),
    findings: (stdout) => typeFindings(dir, stdout),
  };
  return next ? [{ name: "next", command: [bin(dir, "next"), "typegen"], findings: () => [] }, tsc] : [tsc];
}

/** CI: the same order with plain tsc; a failure is reported by exit code. */
export function fullTypecheck(dir: string, next: boolean, projects: readonly string[] = []): ToolStep[] {
  const tsc: ToolStep = { name: "tsc", command: tscCommand(dir, [], projects), timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] };
  return next ? [{ name: "typegen", command: [bin(dir, "next"), "typegen"], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }, tsc] : [tsc];
}

/** CI with a legacy list: the same steps, tsc's errors parsed into findings so each can be judged by its file. */
export function reportTypecheck(dir: string, next: boolean, projects: readonly string[] = []): ToolStep[] {
  return fullTypecheck(dir, next).map((step) =>
    step.name === "tsc"
      ? { ...step, command: tscCommand(dir, ["--pretty", "false"], projects), findings: (stdout: string) => typeFindings(dir, stdout) }
      : step,
  );
}

/** oxc workspaces: the same order, plain project tsc in Done and CI, with parsed findings. */
export function projectTypecheck(dir: string, next: boolean): ToolStep[] {
  const tsc: ToolStep = {
    name: "tsc",
    command: [bin(dir, "tsc"), "--noEmit", "--pretty", "false"],
    timeoutMs: CHECK_TIMEOUT_MS,
    findings: (stdout) => typeFindings(dir, stdout),
  };
  return next ? [{ name: "next", command: [bin(dir, "next"), "typegen"], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }, tsc] : [tsc];
}
