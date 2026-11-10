import { harnessEslint } from "./tooling/harness/presets/eslint.ts";

export default harnessEslint({ root: import.meta.dirname, next: true, harness: "lint" });
