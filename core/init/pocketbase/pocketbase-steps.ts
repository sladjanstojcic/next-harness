import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../../../config.ts";
import { bin } from "../../../tools/tool-set.ts";
import { managerCommands } from "../bootstrap.ts";

const VENDORED = /^pocketbase[^/]*\.d\.ts$/;
const TOOLS = ["oxlint", "oxfmt"];

/** The hand steps of a pocketbase workspace: init writes no file in it, and the harness pins neither of its tools. */
function workspaceTodo(root: string, workspace: WorkspaceEntry): string[] {
  const dir = path.join(root, workspace.path);
  const types = path.join(dir, "types");
  const tsconfig = fs.existsSync(path.join(dir, "tsconfig.json"))
    ? []
    : [
        `Give ${workspace.path}/ its own tsconfig.json with "strict": true, "moduleDetection": "legacy" and the folders pb_hooks, pb_migrations, shared and types in "include" (init does not write it).`,
      ];
  const declared = fs.existsSync(types) && fs.readdirSync(types).some((file) => VENDORED.test(file));
  const declarations = declared ? [] : [`Put the declarations from your PocketBase release in ${workspace.path}/types/ as pocketbase-<version>.d.ts.`];
  const installed = TOOLS.every((tool) => bin(dir, tool, root) !== undefined);
  const tools = installed ? [] : [`Install the tools this folder is checked with, at exact versions: ${managerCommands(root).addDev} ${TOOLS.join(" ")}`];
  return [...tsconfig, ...declarations, ...tools];
}

/** The hand steps of every pocketbase workspace, for init's numbered list. */
export function pocketbaseTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "pocketbase").flatMap((workspace) => workspaceTodo(root, workspace));
}
