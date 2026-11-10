import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, type RepoFixture } from "../../testing/temp-repo.ts";
import { initHarness } from "./init.ts";
import { toolScripts } from "./tool-configs.ts";
import { PACKAGE_SCRIPTS } from "./wiring.ts";

const template = path.resolve(import.meta.dirname, "../../../..");
const SETTINGS = ".claude/settings.json";
const WIRED = [SETTINGS, ".codex/hooks.json", ".codex/config.toml", ".githooks/pre-push"];
const ROOT_SCRIPTS = { ...toolScripts({ path: "", shape: "next-modules", tools: "eslint-prettier", next: true }), ...PACKAGE_SCRIPTS };

function consumer(files: Record<string, string>): RepoFixture {
  const repo = makeRepo(files);
  repo.git("config", "--unset", "core.hooksPath");
  return repo;
}

function templateHooks(): Record<string, unknown[]> {
  return (JSON.parse(fs.readFileSync(path.join(template, SETTINGS), "utf8")) as { hooks: Record<string, unknown[]> }).hooks;
}

function snapshot(repo: RepoFixture): Record<string, string> {
  return Object.fromEntries([...WIRED, "package.json"].filter((file) => fs.existsSync(path.join(repo.root, file))).map((file) => [file, repo.read(file)]));
}

describe("init", () => {
  it("writes exactly this repository's wiring into an empty repository, and a rerun changes nothing", () => {
    const repo = consumer({ "package.json": '{\n  "name": "consumer"\n}\n' });
    const first = initHarness(repo.root, { force: false, starter: false });
    expect(first.ok).toBe(true);
    for (const file of WIRED) expect(repo.read(file), file).toBe(fs.readFileSync(path.join(template, file), "utf8"));
    expect(fs.statSync(path.join(repo.root, ".githooks/pre-push")).mode & 0o111).not.toBe(0);
    expect(repo.git("config", "core.hooksPath").trim()).toBe(".githooks");
    const templateScripts = (JSON.parse(fs.readFileSync(path.join(template, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(Object.fromEntries(Object.keys(PACKAGE_SCRIPTS).map((name) => [name, templateScripts[name]]))).toEqual(PACKAGE_SCRIPTS);
    expect(JSON.parse(repo.read("package.json"))).toEqual({ name: "consumer", scripts: ROOT_SCRIPTS });
    expect(first.report).toContain("created .claude/settings.json: hooks");
    expect(first.report).toContain("CI is not written");

    const before = snapshot(repo);
    const second = initHarness(repo.root, { force: false, starter: false });
    expect(second.ok).toBe(true);
    expect(second.report.split("\n").filter((line) => /^(created|updated|conflict) /.test(line))).toEqual([]);
    expect(snapshot(repo)).toEqual(before);
  });

  it("merges into existing files and keeps MCP servers, permissions, settings and other scripts", () => {
    const repo = consumer({
      "package.json": JSON.stringify({ name: "consumer", scripts: { dev: "next dev" } }, null, "\t"),
      ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }),
      ".codex/hooks.json": JSON.stringify({ mcp: { servers: {} } }),
      ".codex/config.toml": 'model = "gpt"\n\n[mcp_servers.docs]\ncommand = "docs"\n\n[features]\nother = true\n',
    });
    const result = initHarness(repo.root, { force: false, starter: false });
    expect(result.ok).toBe(true);
    expect(result.report).toContain("updated .claude/settings.json: hooks added, other keys kept");
    const settings = JSON.parse(repo.read(".claude/settings.json")) as Record<string, unknown>;
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(settings.hooks).toEqual(templateHooks());
    expect((JSON.parse(repo.read(".codex/hooks.json")) as Record<string, unknown>).mcp).toEqual({ servers: {} });
    expect(repo.read(".codex/config.toml")).toBe('model = "gpt"\n\n[mcp_servers.docs]\ncommand = "docs"\n\n[features]\nhooks = true\nother = true\n');
    const pkg = repo.read("package.json");
    expect(pkg).toContain('\n\t"scripts": {');
    expect(JSON.parse(pkg)).toEqual({ name: "consumer", scripts: { dev: "next dev", ...ROOT_SCRIPTS } });
  });

  it("refuses changed harness hooks, a script, a pre-push hook or a hooks path without --force and writes nothing", () => {
    const stale = { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/tooling/harness/cli.ts" hook claude', timeout: 60 };
    const say = { type: "command", command: "say done" };
    const other = { hooks: { Stop: [{ hooks: [stale, say] }] }, mcpServers: { db: { command: "db" } } };
    const repo = consumer({
      "package.json": JSON.stringify({ name: "consumer", scripts: { check: "turbo check" } }),
      ".claude/settings.json": JSON.stringify(other),
      ".githooks/pre-push": "#!/bin/sh\nexit 0\n",
      ".codex/config.toml": "[features]\nhooks = false\n",
    });
    repo.git("config", "core.hooksPath", ".husky");
    const before = snapshot(repo);
    const refused = initHarness(repo.root, { force: false, starter: false });
    expect(refused.ok).toBe(false);
    expect(refused.report.split("\n").filter((line) => line.startsWith("conflict "))).toEqual([
      "conflict git config core.hooksPath: is .husky; --force sets it to .githooks",
      "conflict .claude/settings.json: harness hooks differ in SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop; --force replaces them there and keeps 1 other hook entry",
      "conflict .codex/config.toml: [features] sets hooks to another value; --force sets it to true",
      "conflict .githooks/pre-push: holds a different hook; --force replaces it",
      "conflict package.json: scripts check differ; --force replaces them",
    ]);
    expect(snapshot(repo)).toEqual(before);
    expect(fs.existsSync(path.join(repo.root, ".codex/hooks.json"))).toBe(false);
    expect(repo.git("config", "core.hooksPath").trim()).toBe(".husky");

    const forced = initHarness(repo.root, { force: true, starter: false });
    expect(forced.ok).toBe(true);
    for (const file of WIRED.slice(1)) expect(repo.read(file), file).toBe(fs.readFileSync(path.join(template, file), "utf8"));
    const wanted = templateHooks();
    expect(JSON.parse(repo.read(SETTINGS))).toEqual({ hooks: { ...wanted, Stop: [...(wanted.Stop ?? []), { hooks: [say] }] }, mcpServers: other.mcpServers });
    expect(repo.git("config", "core.hooksPath").trim()).toBe(".githooks");
    expect((JSON.parse(repo.read("package.json")) as { scripts: unknown }).scripts).toEqual(ROOT_SCRIPTS);
  });

  it("keeps a consumer's own hook events: a Notification hook beside the harness hooks", () => {
    const notification = [{ hooks: [{ type: "command", command: "say waiting" }] }];
    const wanted = templateHooks();
    const exact = consumer({ "package.json": "{}", ".claude/settings.json": JSON.stringify({ hooks: { ...wanted, Notification: notification } }) });
    const untouched = exact.read(SETTINGS);
    expect(initHarness(exact.root, { force: false, starter: false }).report).toContain("unchanged .claude/settings.json: hooks, 1 other hook entry");
    expect(exact.read(SETTINGS)).toBe(untouched);

    const added = consumer({ "package.json": "{}", ".claude/settings.json": JSON.stringify({ hooks: { Notification: notification } }) });
    expect(initHarness(added.root, { force: false, starter: false }).report).toContain(
      "updated .claude/settings.json: harness hooks added, 1 other hook entry kept",
    );
    expect(JSON.parse(added.read(SETTINGS))).toEqual({ hooks: { ...wanted, Notification: notification } });

    const stop = [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/tooling/harness/cli.ts" hook claude', timeout: 120 }] }];
    const changed = consumer({
      "package.json": "{}",
      ".claude/settings.json": JSON.stringify({ hooks: { ...wanted, Stop: stop, Notification: notification } }),
    });
    expect(initHarness(changed.root, { force: false, starter: false }).report).toContain(
      "conflict .claude/settings.json: harness hooks differ in Stop; --force replaces them there and keeps 1 other hook entry",
    );
    expect(initHarness(changed.root, { force: true, starter: false }).report).toContain(
      "updated .claude/settings.json: harness hooks replaced in Stop, 1 other hook entry kept",
    );
    expect(JSON.parse(changed.read(SETTINGS))).toEqual({ hooks: { ...wanted, Notification: notification } });
  });

  it("reads and writes the Codex hooks flag only inside the [features] table", () => {
    const elsewhere = consumer({ "package.json": "{}", ".codex/config.toml": '[mcp_servers.x]\ncommand = "x"\nhooks = true\n' });
    expect(initHarness(elsewhere.root, { force: false, starter: false }).report).toContain(
      "updated .codex/config.toml: [features] hooks = true, other settings kept",
    );
    expect(elsewhere.read(".codex/config.toml")).toBe('[mcp_servers.x]\ncommand = "x"\nhooks = true\n\n[features]\nhooks = true\n');

    const off = consumer({ "package.json": "{}", ".codex/config.toml": "[features]\nother = 1\n\n[mcp_servers.x]\nhooks = false\n" });
    expect(initHarness(off.root, { force: false, starter: false }).ok).toBe(true);
    expect(off.read(".codex/config.toml")).toBe("[features]\nhooks = true\nother = 1\n\n[mcp_servers.x]\nhooks = false\n");
  });

  it("stops during planning when git cannot read its config, before any file is written", () => {
    const repo = consumer({ "package.json": "{}" });
    fs.appendFileSync(path.join(repo.root, ".git", "config"), "\n[[broken\n");
    expect(() => initHarness(repo.root, { force: false, starter: false })).toThrow(/core\.hooksPath cannot be read/);
    expect(WIRED.filter((file) => fs.existsSync(path.join(repo.root, file)))).toEqual([]);
  });

  it("runs from the CLI and rejects unknown flags", () => {
    const repo = consumer({ "package.json": "{}" });
    const cli = path.resolve(import.meta.dirname, "../../cli.ts");
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, "init", ...args], { cwd: repo.root, encoding: "utf8", timeout: 20_000 });
    const ok = run();
    expect([ok.status, ok.stderr]).toEqual([0, ""]);
    expect(ok.stdout).toContain("created .githooks/pre-push: runs the CI gate");
    const bad = run("--yes");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("init [--force] [--codex-user]");
  });
});
