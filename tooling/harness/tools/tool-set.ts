import path from "node:path";
import type { ToolStep } from "../core/gates/run-tool.ts";

/** Formatter, linter, type checker and test runner of one workspace; commands are built for the workspace directory. */
export interface ToolSet {
  name: "eslint-prettier";
  format: { write(dir: string, files: string[]): ToolStep; check(dir: string): ToolStep };
  lint: { files(dir: string, files: string[], fast: boolean): ToolStep; all(dir: string): ToolStep };
  typecheck: { incremental(dir: string, next: boolean): ToolStep[]; all(dir: string, next: boolean): ToolStep[] };
  test: { related(dir: string, files: string[]): ToolStep; all(dir: string): ToolStep };
}

export const CHECK_TIMEOUT_MS = 120_000;

export function bin(dir: string, tool: string): string {
  return path.join(dir, "node_modules/.bin", tool);
}

export function relativePath(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
}
