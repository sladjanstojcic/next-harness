import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sessionFile, stateDir } from "./state/state-file.ts";
import { makeRepo } from "./testing/temp-repo.ts";

describe("hook CLI", () => {
  const cli = path.resolve(import.meta.dirname, "cli.ts");
  function hook(root: string, input: unknown) {
    return spawnSync(process.execPath, [cli, "hook", "claude"], { cwd: root, input: JSON.stringify(input), encoding: "utf8", timeout: 10_000 });
  }
  it("runs PreToolUse without loading audit or gate dependencies", () => {
    const repo = makeRepo();
    const source = path.resolve(import.meta.dirname);
    fs.cpSync(source, path.join(repo.root, "tooling/harness"), { recursive: true });
    repo.write("package.json", '{"type":"module"}');
    fs.mkdirSync(path.join(repo.root, "node_modules"));
    fs.symlinkSync(path.resolve(source, "../../node_modules/zod"), path.join(repo.root, "node_modules/zod"), "dir");
    const input = { hook_event_name: "PreToolUse", session_id: "s", cwd: repo.root, tool_name: "Write", tool_input: { file_path: "src/utils/x.ts" } };
    const result = spawnSync(process.execPath, [path.join(repo.root, "tooling/harness/cli.ts"), "hook", "claude"], {
      cwd: repo.root,
      input: JSON.stringify(input),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("src-shape");
    expect(result.stderr).not.toContain("Cannot find package");
    expect(fs.readFileSync(path.join(stateDir(repo.root), "blocks.jsonl"), "utf8")).toContain('"rules":["structure-write"]');
  });

  it("denies every tool call except the dependency install while node_modules is missing", () => {
    const repo = makeRepo();
    fs.cpSync(path.resolve(import.meta.dirname), path.join(repo.root, "tooling/harness"), { recursive: true });
    repo.write("package.json", '{"type":"module"}');
    const run = (input: unknown) =>
      spawnSync(process.execPath, [path.join(repo.root, "tooling/harness/cli.ts"), "hook", "claude"], {
        cwd: repo.root,
        input: JSON.stringify(input),
        encoding: "utf8",
      });
    const base = { session_id: "s", cwd: repo.root };
    const write = run({ ...base, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/modules/a/index.ts" } });
    expect(write.status).toBe(2);
    expect(write.stderr).toContain("pnpm install --frozen-lockfile");
    expect(write.stderr).not.toContain("Cannot find package");
    const install = run({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm install --frozen-lockfile" } });
    expect([install.status, install.stdout, install.stderr]).toEqual([0, "", ""]);
    const other = run({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm install-nothing && rm -rf src" } });
    expect(other.status).toBe(2);
    const post = run({ ...base, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "src/modules/a/index.ts" } });
    expect(post.status).toBe(0);
    expect(post.stderr).toContain("pnpm install --frozen-lockfile");
  }, 60_000);

  it.each([
    ["PreToolUse", 2],
    ["PostToolUse", 0],
    ["Stop", 0],
    ["UserPromptSubmit", 0],
    ["SessionStart", 0],
  ])("maps malformed %s to exit %s with stderr", (hook_event_name, status) => {
    const result = hook(makeRepo().root, { hook_event_name });
    expect(result.status, result.stderr).toBe(status);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("hook event:");
  });
  it("uses the Git root from process.cwd rather than trusting event.cwd", () => {
    const repo = makeRepo();
    const other = makeRepo();
    fs.mkdirSync(path.join(repo.root, "nested"));
    const result = hook(path.join(repo.root, "nested"), { hook_event_name: "UserPromptSubmit", session_id: "s", cwd: other.root });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(stateDir(repo.root), sessionFile("task", "s")))).toBe(true);
    expect(fs.existsSync(path.join(stateDir(other.root), sessionFile("task", "s")))).toBe(false);
  });
  it("ignores unrelated events silently", () => {
    const result = hook(makeRepo().root, { hook_event_name: "Notification" });
    expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);
  });
  it.each(["PreToolUse", "Stop"])("maps internal Git-root failure for %s", (hook_event_name) => {
    const repo = makeRepo();
    const result = hook(path.dirname(repo.root), { hook_event_name, session_id: "s", cwd: repo.root });
    expect(result.status).toBe(hook_event_name === "PreToolUse" ? 2 : 0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not a git repository");
  });
  it("exposes fast, done and audit commands with meaningful exit codes", () => {
    const repo = makeRepo();
    for (const level of ["fast", "done"]) {
      const result = spawnSync(process.execPath, [cli, "check", level], { cwd: repo.root, encoding: "utf8" });
      expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);
    }
    repo.write("src/utils/x.ts", "\n");
    const audit = spawnSync(process.execPath, [cli, "audit"], { cwd: repo.root, encoding: "utf8" });
    expect(audit.status).toBe(1);
    expect(audit.stdout).toContain("src-shape");
    expect(audit.stderr).toBe("");
  });
});
