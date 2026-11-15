import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, type RepoFixture } from "../../../testing/temp-repo.ts";
import { initHarness } from "../init.ts";

const E2E = "apps/e2e";
const config = (tools = ""): string =>
  `export default { workspaces: [{ path: "apps/web", shape: "next-modules", next: true }, { path: "${E2E}", shape: "e2e"${tools} }], root: { entries: ["apps"] } };\n`;

function consumer(tools = ""): RepoFixture {
  const repo = makeRepo({ "harness.config.ts": config(tools), "package.json": "{}\n", "apps/web/package.json": "{}\n", [`${E2E}/package.json`]: "{}\n" });
  repo.git("config", "--unset", "core.hooksPath");
  return repo;
}

const exists = (repo: RepoFixture, file: string): boolean => fs.existsSync(path.join(repo.root, file));
const init = (repo: RepoFixture): string => {
  const result = initHarness(repo.root, { force: false, starter: false });
  expect(result.ok, result.report).toBe(true);
  return result.report;
};

describe("init on an e2e workspace with ESLint and Prettier", () => {
  it("writes the folder's ESLint and Prettier configs from the presets, and nothing else", () => {
    const repo = consumer();
    const report = init(repo);
    expect(repo.read(`${E2E}/eslint.config.ts`)).toContain('layout: "e2e"');
    expect(repo.read(`${E2E}/prettier.config.ts`)).toContain("presets/prettier.ts");
    for (const file of ["vitest.config.ts", "knip.config.ts", ".dependency-cruiser.json", "playwright.config.ts", "tsconfig.json"])
      expect(exists(repo, `${E2E}/${file}`), file).toBe(false);
    expect(repo.read(`${E2E}/package.json`)).toBe("{}\n");
    const install = report.split("\n").find((line) => line.includes(`(cd ${E2E} && pnpm add -D`));
    expect(install).toContain("eslint@");
    expect(install).not.toContain("vitest@");
  });

  it("writes no ESLint or Prettier config for a folder on oxc", () => {
    const repo = consumer(', tools: "oxc"');
    init(repo);
    for (const file of ["eslint.config.ts", "prettier.config.ts", ".prettierignore"]) expect(exists(repo, `${E2E}/${file}`), file).toBe(false);
  });
});
