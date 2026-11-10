import type { KnipConfig } from "knip";
import { harnessKnipWorkspace } from "./tooling/harness/presets/knip.ts";

const preset = harnessKnipWorkspace({ harness: "analyse" });

export default {
  ...preset,
  entry: [
    ...preset.entry,
    "scripts/*.ts",
    "e2e/**",
    "tooling/harness/shapes/limits.ts",
    "tooling/harness/shapes/next-modules.ts",
    "tooling/harness/tools/eslint-config-runner.ts",
  ],
} satisfies KnipConfig;
