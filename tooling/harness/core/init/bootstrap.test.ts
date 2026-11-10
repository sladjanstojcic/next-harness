import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { CREATE_NEXT_APP } from "../../testing/preset-fixture.ts";
import { consumerRepo } from "../../testing/template-repo.ts";
import { initHarness } from "./init.ts";
import { bootstrapHarness, harnessIsWorkspace } from "./bootstrap.ts";

const HARNESS = path.resolve(import.meta.dirname, "../..");

/** A create-next-app project holding a copy of the harness with no node_modules anywhere above it, as after a subtree add. */
function freshSubtree(files: Record<string, string> = {}) {
  const repo = makeRepo({ ...CREATE_NEXT_APP, ...files });
  fs.cpSync(HARNESS, path.join(repo.root, "tooling/harness"), { recursive: true, filter: (source) => path.basename(source) !== "node_modules" });
  return repo;
}

const init = (root: string, ...flags: string[]) => spawnSync(process.execPath, ["tooling/harness/cli.ts", "init", ...flags], { cwd: root, encoding: "utf8" });

describe("init on a fresh subtree", () => {
  it("lists the harness in create-next-app's pnpm-workspace.yaml, keeps the rest, and says to install and rerun", () => {
    const repo = freshSubtree();
    const result = init(repo.root, "--starter");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        "updated pnpm-workspace.yaml: packages tooling/harness",
        "The harness's own dependencies (typescript, zod) are not installed. Next steps:",
        "  1. pnpm install",
        "  2. node tooling/harness/cli.ts init --starter",
        "",
      ].join("\n"),
    );
    expect(repo.read("pnpm-workspace.yaml")).toBe(`packages:\n  - tooling/harness\n${CREATE_NEXT_APP["pnpm-workspace.yaml"] ?? ""}`);
    expect(harnessIsWorkspace(repo.root)).toBe(true);
    expect(init(repo.root).stdout.split("\n")[0]).toBe("unchanged pnpm-workspace.yaml: packages list tooling/harness");
    expect(fs.existsSync(path.join(repo.root, ".claude"))).toBe(false);
  });

  it.each([
    ["a block list", "packages:\n  - apps/*\n\nallowBuilds:\n  sharp: false\n", "packages:\n  - apps/*\n  - tooling/harness\n\nallowBuilds:\n  sharp: false\n"],
    ["a list that already holds it", "packages:\n  - 'tooling/*'\n", "packages:\n  - 'tooling/*'\n"],
  ])("adds the harness to %s in pnpm-workspace.yaml", (_case, before, after) => {
    const repo = freshSubtree({ "pnpm-workspace.yaml": before });
    init(repo.root);
    expect(repo.read("pnpm-workspace.yaml")).toBe(after);
  });

  it.each([
    ["a flow-style list", "packages: [apps/*]\n", "its packages list is not a block list"],
    ["a list that excludes it", "packages:\n  - tooling/*\n  - '!tooling/harness'\n", "!tooling/harness leaves it out"],
  ])("leaves %s to the user", (_case, text, reason) => {
    const repo = freshSubtree({ "pnpm-workspace.yaml": text });
    expect(init(repo.root).stdout).toContain(`kept pnpm-workspace.yaml: ${reason}; add tooling/harness to the workspace packages by hand`);
    expect(repo.read("pnpm-workspace.yaml")).toBe(text);
  });

  it("adds the harness to package.json workspaces for npm and yarn", () => {
    const npm = freshSubtree({ "package.json": '{\n  "name": "a",\n  "packageManager": "npm@11.0.0"\n}\n' });
    const result = init(npm.root);
    expect(result.stdout).toContain("  1. npm install");
    expect(JSON.parse(npm.read("package.json"))).toEqual({ name: "a", packageManager: "npm@11.0.0", workspaces: ["tooling/harness"] });
    const yarn = freshSubtree({ "package.json": JSON.stringify({ name: "b", workspaces: { packages: ["apps/*"] } }), "yarn.lock": "" });
    expect(init(yarn.root).stdout).toContain("  1. yarn install");
    expect(JSON.parse(yarn.read("package.json"))).toEqual({ name: "b", workspaces: { packages: ["apps/*", "tooling/harness"] } });
    expect(harnessIsWorkspace(yarn.root)).toBe(true);
  });

  it("carries on, writing nothing of its own, where the harness's dependencies are installed", () => {
    const repo = makeRepo(CREATE_NEXT_APP);
    expect(bootstrapHarness(repo.root, [])).toEqual({ ready: true, report: "" });
    expect(repo.read("pnpm-workspace.yaml")).toBe(CREATE_NEXT_APP["pnpm-workspace.yaml"]);
    expect(harnessIsWorkspace(repo.root)).toBe(false);
  });

  it("keeps the harness's linked dependencies out of git under create-next-app's .gitignore", () => {
    const repo = consumerRepo(CREATE_NEXT_APP);
    const ignored = () => repo.git("check-ignore", "-q", "--no-index", "tooling/harness/node_modules/.bin/eslint");
    expect(ignored).toThrow();
    expect(initHarness(repo.root, { force: false, starter: false }).report).toContain("updated .gitignore: test-results/, tooling/harness/node_modules/");
    expect(ignored).not.toThrow();
    expect(initHarness(repo.root, { force: false, starter: false }).report).toContain(
      "unchanged .gitignore: .next/, test-results/, tooling/harness/node_modules/",
    );
  });

  it("prints every next step in the project's package manager", () => {
    const npm = JSON.stringify({ name: "a", packageManager: "npm@11.0.0", dependencies: { zod: "4.6.7" } });
    const report = initHarness(consumerRepo({ ...CREATE_NEXT_APP, "package.json": npm }).root, { force: false, starter: true }).report;
    const steps = report.slice(report.indexOf("Next steps"));
    expect(steps).toContain("npm install server-only@0.0.1");
    expect(steps).toContain("npx prettier --write .");
    expect(steps).toContain("npx playwright install chromium");
    expect(steps).toContain("npm run check");
    expect(steps).not.toContain("pnpm");
  });
});
