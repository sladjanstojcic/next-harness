import { bin, type ToolSet } from "./tool-set.ts";

/** Vitest in the workspace folder: related tests in Done, the whole suite in CI. */
export const vitest: ToolSet["test"] = {
  related: (dir, files) => ({
    name: "vitest",
    command: [bin(dir, "vitest"), "related", "--run", "--passWithNoTests", ...files],
    timeoutMs: 600_000,
    findings: () => [],
  }),
  all: (dir) => ({ name: "vitest", command: [bin(dir, "vitest"), "run"], timeoutMs: 600_000, findings: () => [] }),
};
