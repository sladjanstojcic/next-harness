import type { WorkspaceEntry } from "../../config.ts";
import type { PresetLayout } from "../../presets/eslint-rules.ts";
import { ELECTRON_PROBES } from "../../shapes/electron/electron-vite.ts";
import { sourceProbes } from "../../shapes/next-probes.ts";
import { PACKAGE_PROBES } from "../../shapes/package.ts";
import { VITE_PROBES } from "../../shapes/vite/vite-spa.ts";

/** What the preset and its check read of a workspace. */
export type PresetWorkspace = Pick<WorkspaceEntry, "path" | "shape" | "next" | "sourceRoot">;

const LAYOUTS: Partial<Record<WorkspaceEntry["shape"], PresetLayout>> = { package: "package", "electron-vite": "electron", "vite-spa": "spa" };

/** The preset layout of a workspace; a next-modules workspace without src/ is "app-root". */
export const layoutOf = (workspace: PresetWorkspace): PresetLayout =>
  LAYOUTS[workspace.shape] ?? (workspace.shape === "next-modules" && workspace.sourceRoot === "" ? "app-root" : "app");

/** The probe paths of each layout's shape, `{name}` standing for a fresh token. */
export const PRESET_PROBES: Record<PresetLayout, readonly string[]> = {
  app: sourceProbes("src/"),
  "app-root": sourceProbes(""),
  package: PACKAGE_PROBES,
  electron: ELECTRON_PROBES,
  spa: VITE_PROBES,
};
