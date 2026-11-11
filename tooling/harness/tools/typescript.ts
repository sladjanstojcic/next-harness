import ts from "typescript";
import type { Finding } from "../core/audit/finding.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";
import { bin, CHECK_TIMEOUT_MS, relativePath } from "./tool-set.ts";

export { ts };

/** A tsconfig with every file it extends: its compiler options, and whether it names no file to check by itself. */
export interface TsconfigInForce {
  options: ts.CompilerOptions;
  /** `"files": []` and no `include`: the solution style, whose own `tsc` run checks nothing. */
  checksNothing: boolean;
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
  return { options: parsed.options, checksNothing: Array.isArray(files) && files.length === 0 && !("include" in own && own.include !== undefined) };
}

export const compilerOptionsInForce = (file: string): ts.CompilerOptions | undefined => tsconfigInForce(file)?.options;

function typeFindings(root: string, stdout: string): Finding[] {
  return stdout.split(/\r?\n/).flatMap((line): Finding[] => {
    const match = /^(.*?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (!match) return /^error TS\d+:/.test(line) ? [{ rule: "tsc-failed", file: "", message: line }] : [];
    return [{ file: relativePath(root, match[1] ?? ""), line: Number(match[2]), rule: match[3] ?? "tsc", message: match[4] ?? line }];
  });
}

/** Done: Next type generation first when the workspace is a Next app, then incremental tsc with parsed findings. */
export function incrementalTypecheck(dir: string, next: boolean): ToolStep[] {
  const tsc: ToolStep = {
    name: "tsc",
    command: [bin(dir, "tsc"), "--noEmit", "--incremental", "--pretty", "false"],
    findings: (stdout) => typeFindings(dir, stdout),
  };
  return next ? [{ name: "next", command: [bin(dir, "next"), "typegen"], findings: () => [] }, tsc] : [tsc];
}

/** CI: the same order with plain tsc; a failure is reported by exit code. */
export function fullTypecheck(dir: string, next: boolean): ToolStep[] {
  const tsc: ToolStep = { name: "tsc", command: [bin(dir, "tsc"), "--noEmit"], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] };
  return next ? [{ name: "typegen", command: [bin(dir, "next"), "typegen"], timeoutMs: CHECK_TIMEOUT_MS, findings: () => [] }, tsc] : [tsc];
}

/** CI with a legacy list: the same steps, tsc's errors parsed into findings so each can be judged by its file. */
export function reportTypecheck(dir: string, next: boolean): ToolStep[] {
  return fullTypecheck(dir, next).map((step) =>
    step.name === "tsc" ? { ...step, command: [...step.command, "--pretty", "false"], findings: (stdout: string) => typeFindings(dir, stdout) } : step,
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
