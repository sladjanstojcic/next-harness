import type { WorkspaceEntry } from "../../../config.ts";
import { presetImport } from "../../../tools/eslint-preset.ts";
import { viteVitestText } from "../vite/vite-steps.ts";

/** The knip preset of each shape that has its own; harnessKnip otherwise. */
const KNIP_PRESETS: Partial<Record<WorkspaceEntry["shape"], string>> = {
  package: "harnessKnipPackage",
  "electron-vite": "harnessKnipElectron",
  "vite-spa": "harnessKnipVite",
  "node-service": "harnessKnipNode",
};
export const knipPreset = (workspace: WorkspaceEntry): string => KNIP_PRESETS[workspace.shape] ?? "harnessKnip";

/** The dependency-cruiser preset of each shape that has its own; dependency-cruiser.json otherwise. */
const CRUISER_PRESETS: Partial<Record<WorkspaceEntry["shape"], string>> = {
  package: "dependency-cruiser-package.json",
  "electron-vite": "dependency-cruiser-electron.json",
  "vite-spa": "dependency-cruiser-vite.json",
  "node-service": "dependency-cruiser-node.json",
};
export const cruiserPreset = (workspace: WorkspaceEntry): string => CRUISER_PRESETS[workspace.shape] ?? "dependency-cruiser.json";

/** A Node service's gates leave its integration tests out: they need a running backend. */
const vitestCall = (workspace: WorkspaceEntry): string => (workspace.shape === "node-service" ? "harnessVitest({ integration: false })" : "harnessVitest()");

/** The Vitest config init writes: a Vite app's merges its vite.config.ts, every other one is the preset alone. */
export const vitestText = (workspace: WorkspaceEntry): string =>
  workspace.shape === "vite-spa"
    ? viteVitestText(workspace)
    : `import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";\n\nexport default ${vitestCall(workspace)};\n`;

/** The lines that add the preset to a project's own Vitest config; an Electron project's holds its aliases and needs none. */
export const vitestLines = (workspace: WorkspaceEntry): string[] =>
  workspace.shape === "electron-vite"
    ? []
    : [
        `import { mergeConfig } from "vitest/config"; import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";`,
        `export default mergeConfig(${vitestCall(workspace)}, yourConfig);`,
      ];
