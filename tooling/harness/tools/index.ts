import { CONFIG_FILE, type ToolSetName, type WorkspaceEntry } from "../config.ts";
import { eslintPrettier } from "./eslint-prettier.ts";
import type { ToolSet } from "./tool-set.ts";

const TOOL_SETS: Partial<Record<Exclude<ToolSetName, "none">, ToolSet>> = { "eslint-prettier": eslintPrettier };

function toolSetOf(name: ToolSetName): ToolSet | undefined {
  if (name === "none") return undefined;
  const tools = TOOL_SETS[name];
  if (tools === undefined) throw new Error(`${CONFIG_FILE}: tool set "${name}" is not implemented yet`);
  return tools;
}

/** Phase 1 gates run at the git root, so only a workspace at the root has its tools run; other workspaces get audit, lock and legacy checks. */
export function rootTools(workspaces: readonly WorkspaceEntry[]): { tools: ToolSet; next: boolean } | undefined {
  const root = workspaces.find((workspace) => workspace.path === "");
  const tools = root === undefined ? undefined : toolSetOf(root.tools);
  return root === undefined || tools === undefined ? undefined : { tools, next: root.next };
}
