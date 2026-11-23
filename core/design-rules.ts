import fs from "node:fs";
import path from "node:path";
import { usesShadcn } from "../presets/eslint-rules.ts";
import type { Harness } from "./path-check.ts";

type Workspace = Harness["workspaces"][number];

export const DESIGN_RULES = "DESIGN_RULES.md";
const PLACES: readonly string[] = [DESIGN_RULES, `docs/${DESIGN_RULES}`];

/**
 * The project's design rules file: the root one, else `docs/`, else undefined. Only the repository root counts, also in a
 * monorepo. Any entry counts, a dangling link or a folder too, so nothing is ever written through or over it.
 */
export function designRulesFile(root: string): string | undefined {
  return PLACES.find((file) => {
    try {
      fs.lstatSync(path.join(root, file));
      return true;
    } catch {
      return false;
    }
  });
}

/** The folder a workspace's shape keeps the generated shadcn components in; undefined for a shape without one. */
export const uiFolder = (workspace: Workspace): string | undefined => workspace.shapeImpl.vendored.find((entry) => entry.endsWith("shared/ui/"));

/** A workspace with an interface: its shape keeps shadcn components, or it has `components.json` at its top. */
export const hasInterface = (root: string, workspace: Workspace): boolean => uiFolder(workspace) !== undefined || usesShadcn(path.join(root, workspace.path));
