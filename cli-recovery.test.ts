import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "./testing/temp-repo.ts";

const source = path.resolve(import.meta.dirname);

function harnessRepo(broken: boolean) {
  const repo = makeRepo();
  const harness = path.join(repo.root, "tooling/harness");
  fs.cpSync(source, harness, { recursive: true });
  repo.write("package.json", '{"type":"module"}');
  fs.mkdirSync(path.join(repo.root, "node_modules"));
  fs.symlinkSync(path.resolve(source, "../../node_modules/zod"), path.join(repo.root, "node_modules/zod"), "dir");
  if (broken) fs.renameSync(path.join(harness, "core/hooks/handle.ts"), path.join(harness, "core/hooks/handle.ts.missing"));
  const run = (input: Record<string, unknown>, cwd = repo.root) =>
    spawnSync(process.execPath, [path.join(harness, "cli.ts"), "hook", "claude"], {
      cwd,
      input: JSON.stringify({ session_id: "s", cwd, ...input }),
      encoding: "utf8",
      timeout: 10_000,
    });
  return { root: repo.root, git: repo.git, run };
}

const INSTALLS: [string, number][] = [
  ["pnpm install", 0],
  ["pnpm install --frozen-lockfile", 0],
  ["cd app && pnpm i", 0],
  ["corepack pnpm ci --prefer-offline", 0],
  ["npm ci --no-audit --loglevel=error", 0],
  ["pnpm install && rm -rf src", 2],
  ["pnpm install; echo x", 2],
  ["pnpm install | tee x", 2],
  ["pnpm install `x`", 2],
  ["pnpm install $(x)", 2],
  ["pnpm install > x", 2],
  ["pnpm install < x", 2],
  ["pnpm install & rm -rf src", 2],
  ["pnpm install\nrm -rf src", 2],
  ["cd app && pnpm i && rm -rf src", 2],
  ["npm install https://x/y.tgz", 2],
  ["npm install ../evil", 2],
  ["npm i -g x", 2],
  ["npm i --global x", 2],
  ["pnpm i --registry=http://x/", 2],
  ["pnpm install --dir=../o", 2],
  ["pnpm install --prefix ../o", 2],
  ["pnpm install --dangerously-allow-all-builds", 2],
  ["npm install --ignore-scripts=false", 2],
  ["npm install --reg=http://x/", 2],
  ["npm install --userconfig=../o/.npmrc", 2],
  ["npm install --location=global", 2],
  ["pnpm install --frozen-lockfile=false", 2],
  ["pnpm install --loglevel=ERROR", 2],
  ["pnpm install --frozen-lockfile --offline --no-fund --silent --ignore-scripts --reporter=silent", 0],
];

describe("hook CLI recovery", () => {
  it("allows only a single plain install while a harness module is missing", () => {
    const { run } = harnessRepo(true);
    for (const [command, status] of INSTALLS) {
      const result = run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
      expect(result.status, command).toBe(status);
      if (status === 2) expect(result.stderr, command).toContain("pnpm install --frozen-lockfile");
    }
    const write = run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/modules/a/index.ts" } });
    expect(write.status).toBe(2);
    expect(write.stderr).toContain("pnpm install --frozen-lockfile");
  }, 60_000);

  it("resolves the checkout from a cwd inside .git", () => {
    const { root, run } = harnessRepo(false);
    const gitDir = path.join(root, ".git");
    const ls = run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, gitDir);
    expect([ls.status, ls.stderr]).toEqual([0, ""]);
    const write = run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(root, "src/utils/x.ts") } }, gitDir);
    expect(write.status).toBe(2);
    expect(fs.readFileSync(path.join(gitDir, "harness/blocks.jsonl"), "utf8")).toContain('"rules":["structure-write"]');
  }, 20_000);

  it("resolves a linked worktree's git folder to the main checkout", () => {
    const { root, git, run } = harnessRepo(false);
    git("worktree", "add", "-q", path.join(path.dirname(root), "linked"));
    const worktreeDir = path.join(root, ".git/worktrees/linked");
    const ls = run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, worktreeDir);
    expect([ls.status, ls.stderr]).toEqual([0, ""]);
    const write = run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(root, "src/utils/x.ts") } }, worktreeDir);
    expect(write.status).toBe(2);
    expect(fs.readFileSync(path.join(root, ".git/harness/blocks.jsonl"), "utf8")).toContain('"rules":["structure-write"]');
  }, 20_000);

  it("still fails closed outside any repository", () => {
    const { root, run } = harnessRepo(false);
    const outside = path.dirname(root);
    const result = run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, outside);
    expect(result.status).toBe(2);
  }, 20_000);
});
