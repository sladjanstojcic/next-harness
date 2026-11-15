import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPath, resolveHarness } from "../../path-check.ts";
import { pocketbaseRepo } from "../../../testing/pocketbase/pocketbase-repo.ts";
import type { RepoFixture } from "../../../testing/temp-repo.ts";
import { initHarness } from "../init.ts";

const CONFIG = `export default {
  workspaces: [
    { path: ".", shape: "next-modules", next: true },
    { path: "pocketbase", shape: "pocketbase" },
  ],
  root: { entries: ["pocketbase"] },
};
`;
const REQUIRE_STEP = "Declare require for the hooks in pocketbase/types/require.d.ts: declare function require<T = unknown>(path: string): T;";

/** The pocketbase fixture with the folder on the default tool set, as a consumer that has not pointed git at any hooks yet. */
function consumer(extra: Readonly<Record<string, string>> = {}): RepoFixture {
  const repo = pocketbaseRepo({ "harness.config.ts": CONFIG, ...extra });
  repo.git("config", "--unset", "core.hooksPath");
  fs.rmSync(path.join(repo.root, "node_modules/.bin/prettier"));
  return repo;
}

const exists = (repo: RepoFixture, file: string): boolean => fs.existsSync(path.join(repo.root, file));
const init = (repo: RepoFixture): string => {
  const result = initHarness(repo.root, { force: false, starter: false });
  expect(result.ok).toBe(true);
  return result.report;
};

describe("init on a pocketbase workspace with ESLint and Prettier", () => {
  it("writes the folder's ESLint and Prettier configs from the presets, and its .prettierignore", () => {
    const repo = consumer();
    init(repo);
    const eslint = repo.read("pocketbase/eslint.config.ts");
    expect(eslint).toContain("harnessEslint(");
    expect(eslint).toContain('layout: "pocketbase"');
    expect(eslint).not.toContain("base: false");
    expect(repo.read("pocketbase/prettier.config.ts")).toContain("presets/prettier.ts");
    expect(repo.read("pocketbase/.prettierignore").split("\n")).toContain("types/pocketbase*.d.ts");
  });

  it("writes no other tool config and no package script in the folder", () => {
    const repo = consumer({ "pocketbase/package.json": "{}\n" });
    init(repo);
    for (const file of ["vitest.config.ts", "knip.config.ts", ".dependency-cruiser.json", "playwright.config.ts"]) {
      expect(exists(repo, `pocketbase/${file}`), file).toBe(false);
    }
    expect(repo.read("pocketbase/package.json")).toBe("{}\n");
  });

  it("prints no oxlint, oxfmt or Vitest install, and asks for the require declaration until types/ holds one", () => {
    const repo = consumer();
    const report = init(repo);
    expect(report).not.toMatch(/oxlint|oxfmt/);
    const install = report.split("\n").find((line) => line.includes("(cd pocketbase && pnpm add -D"));
    expect(install).toContain("eslint@");
    expect(install).not.toContain("vitest@");
    expect(report).toContain(REQUIRE_STEP);

    const declared = consumer({ "pocketbase/types/require.d.ts": "declare function require<T = unknown>(path: string): T;\n" });
    expect(init(declared)).not.toContain("types/require.d.ts");
  });

  it("keeps today's oxc steps and writes no ESLint or Prettier config for a folder on oxc", () => {
    const repo = consumer({ "harness.config.ts": CONFIG.replace('shape: "pocketbase" }', 'shape: "pocketbase", tools: "oxc" }') });
    for (const tool of ["oxlint", "oxfmt"]) fs.rmSync(path.join(repo.root, "node_modules/.bin", tool));
    expect(init(repo)).toContain("Install the tools this folder is checked with, at exact versions: pnpm add -D --save-exact oxlint oxfmt");
    for (const file of ["eslint.config.ts", "prettier.config.ts", ".prettierignore"]) expect(exists(repo, `pocketbase/${file}`), file).toBe(false);
  });

  it("lets the configs sit at the folder's top, and no other tool's", () => {
    const harness = resolveHarness(consumer().root);
    for (const file of ["eslint.config.ts", "prettier.config.ts", ".prettierignore"])
      expect(checkPath(`pocketbase/${file}`, harness), file).toEqual({ ok: true });
    for (const file of ["vitest.config.ts", "knip.config.ts"]) expect(checkPath(`pocketbase/${file}`, harness).ok, file).toBe(false);
  });
});
