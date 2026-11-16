import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { pocketbaseRepo } from "../../../testing/pocketbase/pocketbase-repo.ts";
import type { RepoFixture } from "../../../testing/temp-repo.ts";
import { initHarness } from "../init.ts";

const template = path.resolve(import.meta.dirname, "../../../../..");
const LOOSE = "export const a = {x:1}\n";

const STEPS = [
  'Give pocketbase/ its own tsconfig.json with "strict": true, "moduleDetection": "legacy" and the folders pb_hooks, pb_migrations, shared and types in "include" (init does not write it).',
  "Copy pb_data/types.d.ts, which PocketBase writes at its first serve, to pocketbase/types/pocketbase-<version>.d.ts.",
  "Install the tools this folder is checked with, at exact versions: pnpm add -D --save-exact oxlint oxfmt",
];

const listing = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

/** The fixture as a consumer that has not pointed git at any hooks yet; its empty Prettier stand-in would not run init's format step. */
function consumer(extra: Readonly<Record<string, string>> = {}): RepoFixture {
  const repo = pocketbaseRepo(extra);
  repo.git("config", "--unset", "core.hooksPath");
  fs.rmSync(path.join(repo.root, "node_modules/.bin/prettier"));
  return repo;
}

describe("init on a pocketbase workspace", () => {
  it("prints the folder's hand steps and writes no file in it", () => {
    const repo = consumer();
    for (const file of ["pocketbase/tsconfig.json", "node_modules/.bin/oxlint", "node_modules/.bin/oxfmt"]) fs.rmSync(path.join(repo.root, file));
    const folder = path.join(repo.root, "pocketbase");
    const before = listing(folder);
    const result = initHarness(repo.root, { force: false, starter: false });
    expect(result.ok).toBe(true);
    const items = result.report.split("\n").map((line) => line.replace(/^ {2}\d+\. /, ""));
    for (const step of STEPS) expect(items).toContain(step);
    expect(listing(folder)).toEqual(before);
  });

  it("saves exact versions in the project's package manager", () => {
    const managers = [
      ["package-lock.json", "npm install -D --save-exact oxlint oxfmt"],
      ["yarn.lock", "yarn add -D --exact oxlint oxfmt"],
    ] as const;
    for (const [lockfile, command] of managers) {
      const repo = consumer({ [lockfile]: "" });
      for (const tool of ["oxlint", "oxfmt"]) fs.rmSync(path.join(repo.root, "node_modules/.bin", tool));
      expect(initHarness(repo.root, { force: false, starter: false }).report).toContain(`at exact versions: ${command}`);
    }
  });

  it("prints none of them once the folder has its tsconfig, its declarations, its require and its tools", () => {
    const repo = consumer({
      "pocketbase/types/pocketbase-0.40.5.d.ts": "declare const $app: unknown;\n",
      "pocketbase/types/require.d.ts": "declare function require<T = unknown>(path: string): T;\n",
    });
    const { report, ok } = initHarness(repo.root, { force: false, starter: false });
    expect(ok).toBe(true);
    expect(report).not.toMatch(/pocketbase\/|oxlint oxfmt/);
  });

  it("leaves the folder to its own tools: the root app's Prettier and ESLint skip it", async () => {
    const nested = "src/modules/pocketbase/server/loose.ts";
    const repo = consumer({ "pocketbase/shared/loose.ts": LOOSE, "src/shared/lib/loose.ts": LOOSE, [nested]: LOOSE });
    expect(initHarness(repo.root, { force: false, starter: false }).ok).toBe(true);
    expect(repo.read(".prettierignore").split("\n")).toContain("/pocketbase");
    const prettier = path.join(template, "node_modules/.bin/prettier");
    const listed = spawnSync(prettier, ["--list-different", "--no-config", "."], { cwd: repo.root, encoding: "utf8" }).stdout.split("\n");
    expect(listed).toContain("src/shared/lib/loose.ts");
    expect(listed).toContain(nested);
    expect(listed).not.toContain("pocketbase/shared/loose.ts");

    fs.rmSync(path.join(repo.root, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(template, "node_modules"), path.join(repo.root, "node_modules"));
    const preset = path.join(template, "tooling/harness/presets/eslint.ts");
    fs.writeFileSync(
      path.join(repo.root, "eslint.config.ts"),
      `import { harnessEslint } from ${JSON.stringify(preset)};\n\nexport default harnessEslint({ root: import.meta.dirname, next: true });\n`,
    );
    const eslint = new ESLint({ cwd: repo.root });
    expect(await eslint.isPathIgnored(path.join(repo.root, "pocketbase/shared/loose.ts"))).toBe(true);
    expect(await eslint.isPathIgnored(path.join(repo.root, "src/shared/lib/loose.ts"))).toBe(false);
  });
});
