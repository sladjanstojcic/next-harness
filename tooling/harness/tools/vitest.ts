import { lastLines } from "./test-script.ts";
import { bin, type ToolSet } from "./tool-set.ts";

/** The runner puts a timeout notice on the first line; it stays, since the end of a cut-off run names no failure. */
function explain(output: string): string {
  if (!output.startsWith("Tool timed out")) return `Vitest failed. ${lastLines(output)}`;
  const end = output.indexOf("\n");
  return `${output.slice(0, end)} ${lastLines(output.slice(end + 1))}`;
}

/** Vitest in the workspace folder: related tests in Done, the whole suite in CI. A failing run is reported by its end. */
export const vitest: ToolSet["test"] = {
  related: (dir, files) => ({
    name: "vitest",
    command: [bin(dir, "vitest"), "related", "--run", "--passWithNoTests", ...files],
    timeoutMs: 600_000,
    findings: () => [],
    explain,
  }),
  all: (dir) => ({ name: "vitest", command: [bin(dir, "vitest"), "run"], timeoutMs: 600_000, findings: () => [], explain }),
};
