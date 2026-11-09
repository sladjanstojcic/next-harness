import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "./core/gates/ci-gate.ts";
import { doneGate } from "./core/gates/done-gate.ts";
import { fastGate, selectedPaths } from "./core/gates/fast-gate.ts";
import * as runner from "./core/gates/run-tool.ts";
import { resolveHarness } from "./core/path-check.ts";
import { stateDir } from "./core/state/state-file.ts";
import { DEFAULT_CONFIG, expandWorkspaces, loadConfig, workspaceOf, type WorkspaceEntry } from "./config.ts";
import { makeRepo } from "./testing/temp-repo.ts";

const harness = path.resolve(import.meta.dirname);
const entry = (workspace: string, next = false): WorkspaceEntry => ({ path: workspace, shape: "next-modules", tools: "eslint-prettier", next });

describe("loadConfig", () => {
  it("returns the default without a config file", () => {
    const repo = makeRepo();
    expect(loadConfig(repo.root)).toEqual(DEFAULT_CONFIG);
    expect(expandWorkspaces(repo.root, DEFAULT_CONFIG)).toEqual([entry("", true)]);
  });

  it("normalises workspace paths and fills defaults", () => {
    const repo = makeRepo({ "harness.config.ts": 'export default { workspaces: [{ path: "./apps/web/", shape: "next-modules" }] };\n' });
    expect(expandWorkspaces(repo.root, loadConfig(repo.root))).toEqual([entry("apps/web")]);
  });

  it("expands one directory level for a trailing /*", () => {
    const repo = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: "packages/*", shape: "next-modules" }] };\n',
      "packages/b/package.json": "{}",
      "packages/a/package.json": "{}",
      "packages/README.md": "# Packages\n",
    });
    expect(expandWorkspaces(repo.root, loadConfig(repo.root))).toEqual([entry("packages/a"), entry("packages/b")]);
  });

  it.each([
    ['{ workspaces: [{ path: "a", shape: "nope" }] }', /harness\.config\.ts: workspaces\.0\.shape/],
    ['{ workspaces: [{ path: "a", shape: "next-modules" }], extra: true }', /^harness\.config\.ts: default export Unrecognized key: "extra"$/],
    ['{ workspaces: [{ path: "../x", shape: "next-modules" }] }', /harness\.config\.ts: workspaces\.0\.path/],
    ['{ workspaces: [{ path: "a/*/b", shape: "next-modules" }] }', /harness\.config\.ts: workspaces\.0\.path/],
  ])("rejects %s naming the field", (config, message) => {
    const repo = makeRepo({ "harness.config.ts": `export default ${config};\n` });
    expect(() => loadConfig(repo.root)).toThrow(message);
  });

  it("says when the default export is missing", () => {
    const repo = makeRepo({ "harness.config.ts": 'export const config = { workspaces: [{ path: "a", shape: "next-modules" }] };\n' });
    expect(() => loadConfig(repo.root)).toThrow(/^harness\.config\.ts: default export is missing$/);
  });

  it("names the config file when it throws", () => {
    const repo = makeRepo({ "harness.config.ts": 'throw new Error("boom");\n' });
    expect(() => loadConfig(repo.root)).toThrow(/^harness\.config\.ts: boom$/);
  });

  it("loads a config that imports defineHarness from the harness", () => {
    const repo = makeRepo({
      "package.json": '{"type":"module"}',
      "harness.config.ts":
        'import { defineHarness } from "./tooling/harness/config.ts";\nexport default defineHarness({ workspaces: [{ path: "apps/web", shape: "next-modules", next: true }], owned: ["apps/web/src/"] });\n',
    });
    fs.mkdirSync(path.join(repo.root, "tooling/harness"), { recursive: true });
    fs.copyFileSync(path.join(harness, "config.ts"), path.join(repo.root, "tooling/harness/config.ts"));
    fs.mkdirSync(path.join(repo.root, "node_modules"));
    fs.symlinkSync(path.resolve(harness, "../../node_modules/zod"), path.join(repo.root, "node_modules/zod"), "dir");
    expect(loadConfig(repo.root)).toEqual({ workspaces: [{ path: "apps/web", shape: "next-modules", next: true }], owned: ["apps/web/src/"] });
  });
});

describe("workspaceOf", () => {
  it("picks the longest matching workspace and returns the relative path", () => {
    const entries = [entry(""), entry("apps/web")];
    expect(workspaceOf(entries, "apps/web/src/x.ts")).toEqual({ entry: entry("apps/web"), path: "src/x.ts" });
    expect(workspaceOf(entries, "docs/x.md")).toEqual({ entry: entry(""), path: "docs/x.md" });
    expect(workspaceOf(entries, "apps/website/x.ts")).toEqual({ entry: entry(""), path: "apps/website/x.ts" });
    expect(workspaceOf([entry("apps/web")], "docs/x.md")).toBeUndefined();
  });
});

describe("gates without a workspace at the root", () => {
  afterEach(() => vi.restoreAllMocks());

  it("run no tool steps and still audit the nested workspace", async () => {
    const file = "apps/web/src/utils/x.ts";
    const repo = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: "apps/web", shape: "next-modules" }] };\n',
      [file]: "export const x = 1;\n",
    });
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const done = await doneGate(repo.root, [file]);
    const fast = await fastGate(repo.root, [file]);
    const ci = await ciGate(repo.root);
    expect(run).not.toHaveBeenCalled();
    expect(done.passed).toBe(false);
    expect(done.findings).toContainEqual(expect.objectContaining({ rule: "src-shape", file }));
    expect(fast.findings).toContainEqual(expect.objectContaining({ rule: "src-shape", file }));
    expect(ci.report.match(/^[a-z]+: (?:passed|failed)$/gm)).toEqual(["audit: failed"]);
  });

  it("skips files vendored by the workspace's shape, not by the git-root layout", () => {
    const files = ["apps/web/src/shared/ui/b.tsx", "src/shared/ui/b.tsx"];
    const repo = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: "apps/web", shape: "next-modules" }] };\n',
      ...Object.fromEntries(files.map((file) => [file, "export const b = 1;\n"])),
    });
    const root = fs.realpathSync(repo.root);
    expect(selectedPaths(root, files, resolveHarness(root))).toEqual(["src/shared/ui/b.tsx"]);
  });
});

describe("cli with an invalid config", () => {
  const cli = path.join(harness, "cli.ts");
  const run = (root: string, hook_event_name: string) =>
    spawnSync(process.execPath, [cli, "hook", "claude"], {
      cwd: root,
      input: JSON.stringify({ hook_event_name, session_id: "s", cwd: root, tool_name: "Write", tool_input: { file_path: "src/modules/a/index.ts" } }),
      encoding: "utf8",
      timeout: 10_000,
    });

  it("fails PreToolUse closed and lets other events through with the message", () => {
    const repo = makeRepo({ "harness.config.ts": 'export default { workspaces: [{ path: "a", shape: "nope" }] };\n' });
    const pre = run(repo.root, "PreToolUse");
    expect(pre.status).toBe(2);
    expect(pre.stderr).toContain("harness.config.ts: workspaces.0.shape");
    const post = run(repo.root, "PostToolUse");
    expect(post.status).toBe(0);
    expect(post.stderr).toContain("harness.config.ts:");
  });

  it("keeps unlock, lock and blocks working", () => {
    const repo = makeRepo({ "harness.config.ts": 'throw new Error("broken");\n' });
    const command = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: repo.root, encoding: "utf8", timeout: 10_000 });
    const unlock = command("unlock");
    expect(unlock.status, unlock.stderr).toBe(0);
    expect(fs.existsSync(path.join(stateDir(repo.root), "unlock.json"))).toBe(true);
    const lock = command("lock");
    expect(lock.status, lock.stderr).toBe(0);
    expect(fs.existsSync(path.join(stateDir(repo.root), "unlock.json"))).toBe(false);
    expect(command("blocks").status).toBe(0);
    expect(command("audit").stderr).toContain("harness.config.ts: broken");
  });
});
