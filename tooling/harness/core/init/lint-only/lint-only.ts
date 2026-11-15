import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../../../config.ts";
import type { ShapeName } from "../../../shape-names.ts";
import type { Step } from "../files.ts";
import { ignoreEntriesStep, prettierIgnored } from "../ignore-files.ts";
import { ESLINT, label, PRETTIER, toolConfigStep } from "../tool-configs.ts";
import { ts } from "../../../tools/typescript.ts";

/** Shapes whose folder init gives only its ESLint and Prettier configs and its .prettierignore: no package scripts, tests, analysis or tsconfig. */
const LINT_ONLY: readonly ShapeName[] = ["pocketbase", "e2e"];

export const isLintOnly = (workspace: WorkspaceEntry): boolean => LINT_ONLY.includes(workspace.shape);

/** The config steps of a lint-only workspace. */
export function lintOnlySteps(root: string, workspace: WorkspaceEntry): Step[] {
  return [
    ...[ESLINT, PRETTIER].map((tool) => toolConfigStep(root, workspace, tool)),
    ignoreEntriesStep(root, label(workspace, ".prettierignore"), prettierIgnored(workspace)),
  ];
}

/** Whether a folder's own tsconfig.json lists what it checks; one that cannot be read is left to `tsc` to report. */
function namesItsFiles(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const read = ts.readConfigFile(file, ts.sys.readFile);
  const config: unknown = read.config;
  return read.error !== undefined || (typeof config === "object" && config !== null && ("include" in config || "files" in config));
}

/**
 * An e2e folder gets no tsconfig step, yet ESLint's typed rules and the type check read its tsconfig.json: without one the
 * specs are outside any project, and without `include` the compiler follows the written configs into the harness.
 */
export function e2eTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces
    .filter((workspace) => workspace.shape === "e2e" && !namesItsFiles(path.join(root, workspace.path, "tsconfig.json")))
    .map(
      (workspace) =>
        `Give ${workspace.path}/ a tsconfig.json whose "include" names tests and playwright.config.ts, and not eslint.config.ts or prettier.config.ts, which import the harness (init does not write it).`,
    );
}
