import fs from "node:fs";
import path from "node:path";
import type { ToolSetName } from "../config.ts";
import type { Finding } from "../core/audit/finding.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";

/** Formatter, linter, type checker and test runner of one workspace; commands are built for the workspace directory. */
export interface ToolSet {
  name: Exclude<ToolSetName, "none">;
  format: { write(dir: string, files: string[]): ToolStep; check(dir: string): ToolStep };
  lint: { files(dir: string, files: string[], fast: boolean): ToolStep; all(dir: string): ToolStep };
  typecheck: { incremental(dir: string, next: boolean): ToolStep[]; all(dir: string, next: boolean): ToolStep[] };
  test: { related(dir: string, files: string[]): ToolStep; all(dir: string): ToolStep };
}

/** A step whose binary is reachable from no folder between its workspace and the git root. */
export interface MissingTool {
  finding: Finding;
}

export const CHECK_TIMEOUT_MS = 120_000;

const BIN_DIR = "node_modules/.bin";

/** Without a git root, the binary in `dir` itself; with one, the first existing binary walking up from `dir` to the git root. */
export function bin(dir: string, tool: string): string;
export function bin(dir: string, tool: string, gitRoot: string): string | undefined;
export function bin(dir: string, tool: string, gitRoot?: string): string | undefined {
  if (gitRoot === undefined) return path.join(dir, BIN_DIR, tool);
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    const candidate = path.join(current, BIN_DIR, tool);
    if (fs.existsSync(candidate)) return candidate;
    if (current === path.resolve(gitRoot) || current === path.dirname(current)) return undefined;
  }
}

export function relativePath(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
}

/**
 * Moves a step built for a workspace folder into that folder: it runs there, its binaries are looked up
 * from there to the git root, and its findings name git-root paths. A step at the root stays as built.
 */
export function placeStep(gitRoot: string, workspacePath: string, step: ToolStep): ToolStep | MissingTool {
  if (workspacePath === "") return step;
  const dir = path.join(gitRoot, workspacePath);
  const local = path.join(dir, BIN_DIR) + path.sep;
  const command: string[] = [];
  for (const arg of step.command) {
    if (!arg.startsWith(local)) {
      command.push(arg);
      continue;
    }
    const tool = arg.slice(local.length);
    const found = bin(dir, tool, gitRoot);
    if (found === undefined) {
      const message = `${tool} not found from ${workspacePath}; install it or set tools: "none"`;
      return { finding: { rule: `${step.name}-failed`, file: "", message } };
    }
    command.push(found);
  }
  return {
    ...step,
    command,
    cwd: dir,
    findings: (stdout, exitCode) =>
      step.findings(stdout, exitCode).map((finding) => (finding.file === "" ? finding : { ...finding, file: path.posix.join(workspacePath, finding.file) })),
  };
}
