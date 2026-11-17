import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../../core/gates/ci-gate.ts";
import * as runner from "../../core/gates/run-tool.ts";
import { initLegacy } from "../../core/legacy.ts";
import { resolveHarness } from "../../core/path-check.ts";
import type { RepoFixture } from "../temp-repo.ts";
import { PB, pocketbaseEslintRepo } from "./pocketbase-repo.ts";

afterEach(() => vi.restoreAllMocks());

const LONG = 300_000;
const GENERATED = `${PB}/.generated/x.js`;
const LEGACY = "tooling/harness-legacy.json";

/** The PocketBase folder on ESLint and Prettier, with build output the root .gitignore ignores and Prettier would reformat. */
function generatedRepo(legacy = true): { repo: RepoFixture; root: string } {
  const repo = pocketbaseEslintRepo({}, { legacy });
  repo.write(".gitignore", `${repo.read(".gitignore")}/${PB}/.generated/\n`);
  repo.git("commit", "-qam", "Ignore build output");
  repo.write(GENERATED, "const   a = {b:1}\n");
  const root = fs.realpathSync(repo.root);
  const real = runner.runTool;
  vi.spyOn(runner, "runTool").mockImplementation((at, step) => (step.cwd?.startsWith(path.join(root, PB)) === true ? real(at, step) : Promise.resolve([])));
  return { repo, root };
}

const prettierFiles = async (root: string): Promise<string[]> =>
  (await ciGate(root)).findings.filter(({ rule }) => rule === "prettier").map(({ file }) => file);

describe("a git-ignored file a tool in a nested workspace reports", () => {
  it(
    "is no finding of the CI gate and stays off the legacy list, until it is force-added to git",
    async () => {
      const { repo, root } = generatedRepo();
      expect(await prettierFiles(root)).toEqual([]);
      repo.remove(LEGACY);
      await initLegacy(root, resolveHarness(root));
      expect(JSON.parse(repo.read(LEGACY)).files).not.toContain(GENERATED);

      repo.git("add", "-f", GENERATED);
      repo.remove(LEGACY);
      expect(await prettierFiles(root)).toEqual([GENERATED]);
      await initLegacy(root, resolveHarness(root));
      expect(JSON.parse(repo.read(LEGACY)).files).toContain(GENERATED);
    },
    LONG,
  );

  it(
    "passes Prettier without a legacy list too, where the step is judged by its exit code once the file is tracked",
    async () => {
      const { repo, root } = generatedRepo(false);
      const prettier = async (): Promise<string | undefined> => (await ciGate(root)).report.split("\n").find((line) => line.startsWith(`prettier (${PB})`));
      expect(await prettier()).toBe(`prettier (${PB}): passed`);
      repo.git("add", "-f", GENERATED);
      expect(await prettier()).toBe(`prettier (${PB}): failed`);
    },
    LONG,
  );
});
