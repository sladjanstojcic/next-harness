import type { WorkspaceEntry } from "../config.ts";
import { eslintPrettier } from "./eslint-prettier.ts";
import type { ToolSet } from "./tool-set.ts";

const TOOL_SETS: { "eslint-prettier": ToolSet } = { "eslint-prettier": eslintPrettier };

/** Phase 1 gates run at the git root, so only a workspace at the root has its tools run; other workspaces get audit, lock and legacy checks. */
export function rootTools(workspaces: readonly WorkspaceEntry[]): { tools: ToolSet; next: boolean } | undefined {
  const root = workspaces.find((workspace) => workspace.path === "");
  return root === undefined ? undefined : { tools: TOOL_SETS[root.tools], next: root.next };
}
