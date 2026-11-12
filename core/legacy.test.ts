import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../testing/temp-repo.ts";
import * as runner from "./gates/run-tool.ts";
import { pruneLegacy } from "./legacy.ts";
import { resolveHarness } from "./path-check.ts";

afterEach(() => vi.restoreAllMocks());

const LEGACY = "tooling/harness-legacy.json";
const CONFIG = `export default { workspaces: [{ path: ".", shape: "next-modules" }], owned: ["src/modules/mine/"], legacy: "${LEGACY}" };\n`;
const list = (files: string[]): string => `${JSON.stringify({ version: 1, files })}\n`;
const configuredRepo = (files: Record<string, string>) => makeRepo({ "harness.config.ts": CONFIG, ...files });

describe("legacy prune", () => {
  it("prunes the list to the files that still have a finding, and leaves it alone while a tool cannot run", async () => {
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([{ rule: "knip-failed", file: "", message: "knip crashed\nstack" }]);
    const repo = configuredRepo({ "src/modules/mine/helpers/x.ts": "export {};\n", "src/modules/mine/index.ts": "export const one = 1;\n" });
    const all = ["src/modules/mine/gone.ts", "src/modules/mine/helpers/x.ts", "src/modules/mine/index.ts"];
    repo.write(LEGACY, list(all));
    const harness = resolveHarness(repo.root);
    await expect(pruneLegacy(repo.root, harness)).rejects.toThrow(
      `${LEGACY} is unchanged, because these steps did not run to the end:\nknip-failed: knip crashed`,
    );
    expect(JSON.parse(repo.read(LEGACY))).toEqual({ version: 1, files: all });
    run.mockResolvedValue([]);
    expect(await pruneLegacy(repo.root, harness)).toBe(
      `Removed 2 of 3 files from ${LEGACY}; they have no finding left:\nsrc/modules/mine/gone.ts\nsrc/modules/mine/index.ts\nCommit the list.`,
    );
    expect(JSON.parse(repo.read(LEGACY))).toEqual({ version: 1, files: ["src/modules/mine/helpers/x.ts"] });
    expect(await pruneLegacy(repo.root, harness)).toBe(`${LEGACY} is unchanged: all 1 files still have a finding.`);
    await expect(pruneLegacy(repo.root, { ...harness, config: { workspaces: harness.config.workspaces } })).rejects.toThrow("no list to prune");
  });
});
