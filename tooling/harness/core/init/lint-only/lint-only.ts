import type { WorkspaceEntry } from "../../../config.ts";
import type { ShapeName } from "../../../shape-names.ts";
import type { Step } from "../files.ts";
import { ignoreEntriesStep, prettierIgnored } from "../ignore-files.ts";
import { ESLINT, label, PRETTIER, toolConfigStep } from "../tool-configs.ts";

/** Shapes whose folder init gives only its ESLint and Prettier configs, and a .prettierignore for its vendored files: no package scripts, tests, analysis or tsconfig. */
const LINT_ONLY: readonly ShapeName[] = ["pocketbase", "e2e"];

export const isLintOnly = (workspace: WorkspaceEntry): boolean => LINT_ONLY.includes(workspace.shape);

/** The config steps of a lint-only workspace; an e2e folder vendors nothing, so it gets no .prettierignore. */
export function lintOnlySteps(root: string, workspace: WorkspaceEntry): Step[] {
  const ignored = prettierIgnored(workspace);
  return [
    ...[ESLINT, PRETTIER].map((tool) => toolConfigStep(root, workspace, tool)),
    ...(ignored.length === 0 ? [] : [ignoreEntriesStep(root, label(workspace, ".prettierignore"), ignored)]),
  ];
}
