import type { ShapeName } from "../../shape-names.ts";

/**
 * The folders of the pocketbase workspaces, which the root app's Prettier and ESLint skip: each folder's own ESLint and
 * Prettier, or oxlint and oxfmt on `tools: "oxc"`, check it from its own configs. They run inside the folder, so the
 * root's ignores do not reach them.
 */
export function pocketbaseFolders(workspaces: readonly { shape: ShapeName; path: string }[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "pocketbase").map((workspace) => workspace.path.replace(/^\.\/|\/+$/g, ""));
}
