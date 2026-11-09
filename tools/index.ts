import path from "node:path";
import { CONFIG_FILE, workspaceOf, type ToolSetName, type WorkspaceEntry } from "../config.ts";
import { eslintPrettier } from "./eslint-prettier.ts";
import type { ToolSet } from "./tool-set.ts";

const TOOL_SETS: Partial<Record<Exclude<ToolSetName, "none">, ToolSet>> = { "eslint-prettier": eslintPrettier };

function toolSetOf(name: ToolSetName): ToolSet | undefined {
  if (name === "none") return undefined;
  const tools = TOOL_SETS[name];
  if (tools === undefined) throw new Error(`${CONFIG_FILE}: tool set "${name}" is not implemented yet`);
  return tools;
}

export interface WorkspaceTools {
  workspace: WorkspaceEntry;
  tools: ToolSet;
  /** Absolute workspace folder; the git root itself for a workspace at the root. */
  dir: string;
  /** Workspace-relative paths, in the order given. */
  files: string[];
}

/** Every workspace whose tool set has steps, in config order; `tools: "none"` workspaces run no tool steps. */
export function toolWorkspaces(gitRoot: string, workspaces: readonly WorkspaceEntry[]): WorkspaceTools[] {
  return workspaces.flatMap((workspace) => {
    const tools = toolSetOf(workspace.tools);
    return tools === undefined ? [] : [{ workspace, tools, dir: path.join(gitRoot, workspace.path), files: [] }];
  });
}

/** Groups git-root-relative files by the workspace holding them; workspaces without files are left out. */
export function workspaceTools(gitRoot: string, workspaces: readonly WorkspaceEntry[], files: readonly string[]): WorkspaceTools[] {
  const groups = toolWorkspaces(gitRoot, workspaces);
  for (const file of files) {
    const found = workspaceOf(workspaces, file);
    groups.find((group) => group.workspace === found?.entry)?.files.push(found?.path ?? file);
  }
  return groups.filter((group) => group.files.length > 0);
}
