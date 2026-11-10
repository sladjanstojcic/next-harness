import { mergeConfig } from "vitest/config";
import { harnessVitest } from "./tooling/harness/presets/vitest.ts";

export default mergeConfig(harnessVitest({ passWithNoTests: false }), { test: { include: ["tooling/**/*.test.ts"] } });
