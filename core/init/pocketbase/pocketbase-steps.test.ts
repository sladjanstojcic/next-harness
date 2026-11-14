import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pocketbaseRepo } from "../../../testing/pocketbase/pocketbase-repo.ts";
import type { RepoFixture } from "../../../testing/temp-repo.ts";
import { initHarness } from "../init.ts";

const STEPS = [
  'Give pocketbase/ its own tsconfig.json with "strict": true, "moduleDetection": "legacy" and the folders pb_hooks, pb_migrations, shared and types in "include" (init does not write it).',
  "Put the declarations from your PocketBase release in pocketbase/types/ as pocketbase-<version>.d.ts.",
  "Install the tools this folder is checked with, at exact versions: pnpm add -D oxlint oxfmt",
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

  it("prints none of them once the folder has its tsconfig, its declarations and its tools", () => {
    const repo = consumer({ "pocketbase/types/pocketbase-0.40.5.d.ts": "declare const $app: unknown;\n" });
    const { report, ok } = initHarness(repo.root, { force: false, starter: false });
    expect(ok).toBe(true);
    expect(report).not.toMatch(/pocketbase\/|oxlint oxfmt/);
  });
});
