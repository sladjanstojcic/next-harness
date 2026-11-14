import type { ShapeName } from "../../shape-names.ts";

/**
 * The folders of the pocketbase workspaces, which the root app's Prettier and ESLint skip: their own oxfmt and oxlint
 * check them. Both run inside the folder and read no ignore file above it, so the root's ignores do not reach them.
 */
export function pocketbaseFolders(workspaces: readonly { shape: ShapeName; path: string }[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "pocketbase").map((workspace) => workspace.path.replace(/^\.\/|\/+$/g, ""));
}
