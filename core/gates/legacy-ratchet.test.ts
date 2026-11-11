import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRE_EXISTING_HEADING } from "../classes.ts";
import { DASHBOARD_LEGACY_FILES, dashboardRepo } from "../../testing/dashboard-repo.ts";
import { makeRepo, type RepoFixture } from "../../testing/temp-repo.ts";
import { testScript } from "../../tools/test-script.ts";
import { ciGate } from "./ci-gate.ts";
import { doneGate } from "./done-gate.ts";
import * as runner from "./run-tool.ts";

afterEach(() => vi.restoreAllMocks());

const [LEGACY_UTIL, LEGACY_CHART] = DASHBOARD_LEGACY_FILES;
const NEW_FILE = "apps/dashboard/src/modules/usage/components/usage.tsx";
const inDashboard = (file: string): string => file.replace("apps/dashboard/", "");

/** What each tool prints for the given git-root files, in the format its per-file report step parses; `root` is the path the gate runs under. */
function toolOutput(root: string, files: readonly string[]) {
  const absolute = (file: string): string => path.join(root, file);
  const lint = files.map((file) => ({ filePath: absolute(file), messages: [{ ruleId: "no-console", severity: 2, message: "No console.", line: 3 }] }));
  return {
    prettier: [files.map(inDashboard).join("\n"), files.length === 0 ? 0 : 1] as const,
    eslint: [JSON.stringify(lint), files.length === 0 ? 0 : 1] as const,
    tsc: [files.map((file) => `${inDashboard(file)}(2,1): error TS2322: Type mismatch.`).join("\n"), files.length === 0 ? 0 : 2] as const,
    knip: [JSON.stringify({ issues: files.map((file) => ({ file: inDashboard(file), exports: [{ name: "unused" }] })) }), files.length === 0 ? 0 : 1] as const,
  };
}

/** Runs CI with every tool reporting a finding on each of `files`, and records the commands. */
async function ciWith(repo: RepoFixture, files: readonly string[]) {
  const output = toolOutput(repo.root, files);
  const commands: string[] = [];
  vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
    commands.push([path.basename(step.command[0] ?? ""), ...step.command.slice(1, 4)].join(" "));
    const printed = step.name in output ? output[step.name as keyof typeof output] : undefined;
    return printed === undefined ? [] : step.findings(printed[0], printed[1]);
  });
  return { result: await ciGate(repo.root), commands };
}

const summary = (findings: { file: string; rule: string }[]): string[] => findings.map(({ file, rule }) => `${file} ${rule}`);

describe("CI with a legacy list: tool findings are judged file by file", () => {
  it("reads per-file reports, tolerates old findings on an untouched legacy file and counts them once per step", async () => {
    const repo = dashboardRepo();
    const { result, commands } = await ciWith(repo, [LEGACY_UTIL]);
    expect(commands.slice(0, 2)).toEqual(["prettier --list-different .", "eslint . --format json"]);
    expect(commands).toContain("tsc --noEmit --pretty false");
    expect(commands).toContain("depcruise src --config .dependency-cruiser.json");
    expect(commands).toContain("knip --reporter json");
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.report).not.toContain(": failed");
    const tail = result.report.slice(result.report.indexOf(PRE_EXISTING_HEADING)).split("\n");
    expect(tail.slice(0, 6)).toEqual([
      PRE_EXISTING_HEADING,
      "prettier (apps/dashboard): 1 finding in 1 file",
      "eslint (apps/dashboard): 1 finding in 1 file",
      "tsc (apps/dashboard): 1 finding in 1 file",
      "audit: 2 findings in 2 files",
      "knip (apps/dashboard): 1 finding in 1 file",
    ]);
    expect(summary(result.preExisting)).toContain(`${LEGACY_UTIL} TS2322`);
  });

  it("fails on the same findings in a new file, and in a legacy file with uncommitted changes", async () => {
    const repo = dashboardRepo();
    repo.write(NEW_FILE, "export function Usage() { return null; }\n");
    const fresh = await ciWith(repo, [NEW_FILE]);
    expect(fresh.result.passed).toBe(false);
    expect(summary(fresh.result.findings)).toEqual([`${NEW_FILE} prettier`, `${NEW_FILE} no-console`, `${NEW_FILE} TS2322`, `${NEW_FILE} knip-exports`]);
    repo.remove(NEW_FILE);
    vi.restoreAllMocks();
    repo.write(LEGACY_UTIL, "export const formatDate = (value: Date) => value.toISOString().slice(0, 10);\n");
    const touched = await ciWith(repo, [LEGACY_UTIL, LEGACY_CHART]);
    expect(summary(touched.result.findings)).toEqual([
      `${LEGACY_UTIL} prettier`,
      `${LEGACY_UTIL} no-console`,
      `${LEGACY_UTIL} TS2322`,
      `${LEGACY_UTIL} knip-exports`,
    ]);
    expect(summary(touched.result.preExisting)).toContain(`${LEGACY_CHART} no-console`);
  });

  it("without a remote compares with HEAD; with one, a committed change since the merge base still fails", async () => {
    const repo = dashboardRepo();
    const edit = () => repo.write(LEGACY_UTIL, "export const formatDate = (value: Date) => value.toISOString().slice(0, 10);\n");
    edit();
    repo.git("commit", "-qam", "touch a legacy file");
    expect((await ciWith(repo, [LEGACY_UTIL])).result.passed).toBe(true);
    vi.restoreAllMocks();
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "next harness-remote-"));
    try {
      repo.git("init", "-q", "--bare", remote);
      repo.git("remote", "add", "origin", remote);
      repo.git("push", "-q", "origin", "HEAD~1:refs/heads/main");
      repo.git("fetch", "-q", "origin");
      const pushed = await ciWith(repo, [LEGACY_UTIL]);
      expect(summary(pushed.result.findings)).toContain(`${LEGACY_UTIL} no-console`);
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
    }
  });

  it("fails with one finding in a shallow clone that lacks the remote default branch, instead of comparing with HEAD", async () => {
    const repo = dashboardRepo();
    repo.git("checkout", "-q", "-b", "work");
    repo.write(LEGACY_UTIL, "export const formatDate = (value: Date) => value.toISOString().slice(0, 10);\n");
    repo.git("commit", "-qam", "touch a legacy file");
    repo.git("checkout", "-q", "main");
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "next harness-shallow-"));
    try {
      const clone = path.join(parent, "clone");
      repo.git("clone", "-q", "--depth", "1", "--branch", "work", `file://${fs.realpathSync(repo.root)}`, clone);
      vi.spyOn(runner, "runTool").mockResolvedValue([]);
      const result = await ciGate(clone);
      expect(summary(result.findings)[0]).toBe(" legacy-base-failed");
      expect(result.report).toContain("legacy-base: failed\n:1 legacy-base-failed — The legacy list is judged against the merge base");
      expect(result.report).toContain("fetch-depth: 0");
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("still fails a finding without a file", async () => {
    const repo = dashboardRepo();
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) =>
      step.name === "eslint" ? [{ rule: "eslint-failed", file: "", message: "Oops! Something went wrong!" }] : [],
    );
    const result = await ciGate(repo.root);
    expect(summary(result.findings)).toEqual([" eslint-failed"]);
  });
});

describe("a configured next-modules workspace without src/", () => {
  const analysed = (run: { mock: { calls: [string, runner.ToolStep][] } }): string[] =>
    run.mock.calls.filter(([, step]) => step.name === "depcruise" || step.name === "jscpd").map(([, step]) => `${step.name} ${step.command[1] ?? ""}`);
  const withoutSrc = (app: boolean) => {
    const repo = dashboardRepo();
    fs.rmSync(path.join(repo.root, "apps/dashboard/src"), { recursive: true });
    if (app) repo.write("apps/dashboard/app/page.tsx", "export default function Page() { return null; }\n");
    repo.write("tooling/harness-legacy.json", `${JSON.stringify({ version: 1, files: [] })}\n`);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "an app without src/");
    return repo;
  };

  it("runs depcruise and jscpd on app/ at the workspace top, in CI and Done", async () => {
    const repo = withoutSrc(true);
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const ci = await ciGate(repo.root);
    expect(ci.report).toContain("depcruise (apps/dashboard): passed\nknip (apps/dashboard): passed\njscpd (apps/dashboard): passed");
    expect(ci.passed).toBe(true);
    expect(analysed(run)).toEqual(["depcruise app", "jscpd app"]);
    run.mockClear();
    repo.write("apps/dashboard/app/page.tsx", "export default function Page() { return <main />; }\n");
    const done = await doneGate(repo.root, ["apps/dashboard/app/page.tsx"]);
    expect(done.report).not.toContain("skipped");
    expect(analysed(run)).toEqual(["depcruise app", "jscpd app"]);
  });

  it("skips them while the workspace has neither src/ nor app/, and without harness.config.ts never", async () => {
    const repo = withoutSrc(false);
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const ci = await ciGate(repo.root);
    expect(ci.report).toContain("depcruise (apps/dashboard): skipped (no src/)\nknip (apps/dashboard): passed\njscpd (apps/dashboard): skipped (no src/)");
    expect(analysed(run)).toEqual([]);
    repo.write(NEW_FILE, "export function Usage() { return null; }\n");
    await ciGate(repo.root);
    expect(analysed(run)).toEqual(["depcruise src", "jscpd src"]);
    run.mockClear();
    const plain = await ciGate(makeRepo({ "app/page.tsx": "" }).root);
    expect(plain.report).not.toContain("skipped (no src/)");
    expect(analysed(run)).toEqual(["depcruise app", "jscpd app"]);
  });
});

describe("a workspace's own test script", () => {
  const CONFIG = `export default { workspaces: [{ path: "apps/api", shape: "next-modules", test: "test" }], root: { entries: ["apps"] }, analysis: [] };\n`;
  const withTests = (script: string) =>
    makeRepo({
      "harness.config.ts": CONFIG,
      "package.json": '{ "packageManager": "npm@11.0.0" }\n',
      "apps/api/package.json": JSON.stringify({ scripts: { test: script } }),
      "apps/api/src/shared/lib/a.ts": "export const a = 1;\n",
    });

  it("replaces Vitest in CI and Done, run whole in the workspace through the package manager", async () => {
    const repo = withTests("node --test");
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const ci = await ciGate(repo.root);
    await doneGate(repo.root, ["apps/api/src/shared/lib/a.ts"]);
    const tests = run.mock.calls.map(([, step]) => step).filter((step) => step.name === "test" || step.name === "vitest");
    expect(tests.map((step) => `${path.relative(fs.realpathSync(repo.root), fs.realpathSync(step.cwd ?? ""))}: ${step.command.slice(3).join(" ")}`)).toEqual([
      "apps/api: sh npm run test",
      "apps/api: sh npm run test",
    ]);
    expect(ci.report).toContain("test (apps/api): passed");
  });

  it("fails the gate with the end of a failing run's output", async () => {
    const repo = withTests(`node -e "console.log('first line'); console.error('assertion failed: 1 !== 2'); process.exit(3)"`);
    const findings = await runner.runTool(repo.root, testScript(repo.root, path.join(repo.root, "apps/api"), "test"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("test-failed");
    expect(findings[0]?.message).toMatch(/^The "test" script exited with [1-9]\d*\. Its last lines:\n[\s\S]*assertion failed: 1 !== 2/);
    const passing = withTests(`node -e "process.exit(0)"`);
    expect(await runner.runTool(passing.root, testScript(passing.root, path.join(passing.root, "apps/api"), "test"))).toEqual([]);
  });

  it("is refused on a workspace that runs no tools", () => {
    const repo = makeRepo({ "harness.config.ts": `export default { workspaces: [{ path: "supabase", shape: "supabase", test: "test" }] };\n` });
    return expect(ciGate(repo.root)).rejects.toThrow('harness.config.ts: workspaces.0.test needs a tool set; a workspace with tools: "none" runs no steps');
  });
});

describe("Done with a legacy list", () => {
  it("still blocks a tool finding on an edited legacy file, and prints the other old debt as counts", async () => {
    const repo = dashboardRepo();
    repo.write(LEGACY_UTIL, "export const formatDate = (value: Date) => value.toISOString().slice(0, 10);\n");
    const lint = toolOutput(fs.realpathSync(repo.root), [LEGACY_UTIL, LEGACY_CHART]).eslint;
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => (step.name === "eslint" ? step.findings(lint[0], lint[1]) : []));
    const result = await doneGate(repo.root, [LEGACY_UTIL]);
    expect(summary(result.findings)).toEqual([`${LEGACY_UTIL} no-console`]);
    expect(result.report).toContain("Outside this turn's files (not blocking):\nharness rules: 2 findings in 2 files\ntools: 1 finding in 1 file\n");
  });
});
