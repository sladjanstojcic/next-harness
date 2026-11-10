import type { KnipConfig } from "knip";
import { harnessKnip } from "./tooling/harness/presets/knip.ts";

const preset = harnessKnip();

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
  ignore: preset.ignore.filter((glob) => glob !== "tooling/harness/**"),
} satisfies KnipConfig;
