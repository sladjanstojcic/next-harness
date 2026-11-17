import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../core/gates/ci-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { initLegacy } from "../core/legacy.ts";
import { resolveHarness } from "../core/path-check.ts";
import { templateRepo } from "./template-repo.ts";

afterEach(() => vi.restoreAllMocks());

const LONG = 300_000;
const LEGACY = "tooling/harness-legacy.json";

/** A template app whose layout has a wrong props type: Next reports it in the git-ignored .next/types/validator.ts. */
function wrongLayoutRepo(): string {
  const repo = templateRepo({
    "harness.config.ts": `export default { workspaces: [{ path: ".", shape: "next-modules", next: true }], legacy: "${LEGACY}" };\n`,
    "src/app/layout.tsx": "export default function Layout({ children }: { children: string }) { return <html><body>{children}</body></html>; }\n",
  });
  const root = fs.realpathSync(repo.root);
  const real = runner.runTool;
  vi.spyOn(runner, "runTool").mockImplementation((at, step) => (["typegen", "tsc"].includes(step.name) ? real(at, step) : Promise.resolve([])));
  return root;
}

describe("a type error tsc reports in a git-ignored file", () => {
  it(
    "fails the CI gate with a legacy list and stays in legacy init's view",
    async () => {
      const root = wrongLayoutRepo();
      const result = await ciGate(root);
      expect(result.report).toContain("tsc: failed");
      expect(result.findings.map(({ rule }) => rule)).toContain("TS2344");
      await initLegacy(root, resolveHarness(root));
      expect(fs.readFileSync(`${root}/${LEGACY}`, "utf8")).toContain(".next/types/validator.ts");
    },
    LONG,
  );
});
