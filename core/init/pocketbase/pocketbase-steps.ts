import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../../../config.ts";
import { bin } from "../../../tools/tool-set.ts";
import { managerCommands } from "../bootstrap.ts";

const VENDORED = /^pocketbase[^/]*\.d\.ts$/;
const TOOLS = ["oxlint", "oxfmt"];

const REQUIRE = "declare function require<T = unknown>(path: string): T;";

/** Whether a declaration in types/ already gives require its type parameter. */
function declaresRequire(types: string): boolean {
  if (!fs.existsSync(types)) return false;
  return fs
    .readdirSync(types)
    .some((file) => fs.statSync(path.join(types, file)).isFile() && fs.readFileSync(path.join(types, file), "utf8").includes("function require<"));
}

/** The hand steps of a pocketbase workspace: init writes none of its tsconfig, declarations or oxc tools. */
function workspaceTodo(root: string, workspace: WorkspaceEntry): string[] {
  const dir = path.join(root, workspace.path);
  const types = path.join(dir, "types");
  const tsconfig = fs.existsSync(path.join(dir, "tsconfig.json"))
    ? []
    : [
        `Give ${workspace.path}/ its own tsconfig.json with "strict": true, "moduleDetection": "legacy" and the folders pb_hooks, pb_migrations, shared and types in "include" (init does not write it).`,
      ];
  const declared = fs.existsSync(types) && fs.readdirSync(types).some((file) => VENDORED.test(file));
  const declarations = declared
    ? []
    : [`Copy pb_data/types.d.ts, which PocketBase writes at its first serve, to ${workspace.path}/types/pocketbase-<version>.d.ts.`];
  const require = declaresRequire(types) ? [] : [`Declare require for the hooks in ${workspace.path}/types/require.d.ts: ${REQUIRE}`];
  const installed = workspace.tools !== "oxc" || TOOLS.every((tool) => bin(dir, tool, root) !== undefined);
  const tools = installed ? [] : [`Install the tools this folder is checked with, at exact versions: ${managerCommands(root).addDevExact} ${TOOLS.join(" ")}`];
  return [...tsconfig, ...declarations, ...require, ...tools];
}

/** The hand steps of every pocketbase workspace, for init's numbered list. */
export function pocketbaseTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "pocketbase").flatMap((workspace) => workspaceTodo(root, workspace));
}
