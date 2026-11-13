import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makerkitRepo } from "../../testing/makerkit-repo.ts";
import { makeRepo, type RepoFixture } from "../../testing/temp-repo.ts";
import { isLocked } from "../lock.ts";
import { checkPath, resolveHarness } from "../path-check.ts";
import { initHarness } from "./init.ts";
import { PREPARE } from "./wiring.ts";

const template = path.resolve(import.meta.dirname, "../../../..");
const OFF = { force: false, starter: false };
const HARNESS_LINES = "tooling/harness\nharness.config.ts\n";

function unhooked(repo: RepoFixture): RepoFixture {
  repo.git("config", "--unset", "core.hooksPath");
  return repo;
}

describe("block 790f94: a project's formatter and linter leave the harness alone", () => {
  it("writes root .prettierignore (oxfmt) and .eslintignore (oxlint) for a Makerkit project, both allowed at the root", () => {
    const repo = unhooked(makerkitRepo());
    expect(initHarness(repo.root, OFF).ok).toBe(true);
    expect(repo.read(".prettierignore")).toBe(HARNESS_LINES);
    expect(repo.read(".eslintignore")).toBe(HARNESS_LINES);
    const harness = resolveHarness(repo.root);
    for (const file of [".prettierignore", ".eslintignore"]) expect(checkPath(file, harness), file).toEqual({ ok: true });
    expect(isLocked(".prettierignore", harness.config)).toBe(true);
  });

  it("keeps a real `prettier --list-different .` off tooling/harness and harness.config.ts in a Prettier consumer", () => {
    const repo = unhooked(
      makeRepo({
        "package.json": "{}\n",
        "harness.config.ts": "export default {workspaces:[{path:'.',shape:'next-modules'}]}\n",
        "tooling/harness/cli.ts": "export const a = {x:1}\n",
        "src/app/page.tsx": "export default function Page(){return null}\n",
      }),
    );
    expect(initHarness(repo.root, OFF).ok).toBe(true);
    const prettier = path.join(template, "node_modules/.bin/prettier");
    const listed = spawnSync(prettier, ["--list-different", "--no-config", "."], { cwd: repo.root, encoding: "utf8" }).stdout.split("\n");
    expect(listed).toContain("src/app/page.tsx");
    expect(listed).not.toContain("tooling/harness/cli.ts");
    expect(listed).not.toContain("harness.config.ts");
  });

  it("leaves the harness formatted and linted in the repository that develops it", () => {
    const repo = unhooked(makeRepo({ "package.json": "{}\n", "eslint.config.ts": 'export default harnessEslint({ root: ".", harness: "lint" });\n' }));
    expect(initHarness(repo.root, OFF).ok).toBe(true);
    expect(repo.read(".prettierignore")).toBe("pnpm-lock.yaml\nsrc/shared/ui\nsrc/backend/*.types.ts\nsrc/backend/*-types.ts\n.next\n");
    expect(fs.existsSync(path.join(repo.root, ".eslintignore"))).toBe(false);
  });
});

describe("a fresh clone gets the pre-push hook", () => {
  it("adds the prepare script when there is none, and asks for it beside an existing one", () => {
    const fresh = unhooked(makeRepo({ "package.json": "{}\n" }));
    const first = initHarness(fresh.root, OFF);
    expect((JSON.parse(fresh.read("package.json")) as { scripts: Record<string, string> }).scripts.prepare).toBe(PREPARE);
    expect(first.report).not.toContain('"prepare" script');
    const own = unhooked(makeRepo({ "package.json": JSON.stringify({ scripts: { prepare: "husky" } }) }));
    const second = initHarness(own.root, OFF);
    expect((JSON.parse(own.read("package.json")) as { scripts: Record<string, string> }).scripts.prepare).toBe("husky");
    expect(second.report).toContain(`Add to the root package.json "prepare" script, so a fresh clone gets the pre-push hook: ${PREPARE}`);
  });
});
