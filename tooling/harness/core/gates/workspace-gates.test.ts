import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCE_PROBES } from "../../shapes/next-modules.ts";
import { normaliseProbes } from "../../testing/preset-fixture.ts";
import { CONFIG_RUNNER } from "../../tools/eslint-preset.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { ciGate } from "./ci-gate.ts";
import { doneGate } from "./done-gate.ts";
import { fastGate } from "./fast-gate.ts";
import * as runner from "./run-tool.ts";

afterEach(() => vi.restoreAllMocks());

const CONFIG = `export default {
  workspaces: [{ path: "apps/web", shape: "next-modules", next: true }, { path: "packages/*", shape: "next-modules" }],
  root: { entries: ["apps", "packages"] },
};
`;
const WEB = "apps/web/src/shared/lib/a.ts";
const PACKAGE = "packages/a/src/shared/lib/b.ts";
const ALL_TOOLS = ["tsc", "eslint", "prettier", "vitest", "depcruise", "knip", "jscpd"];
const ANALYSIS = ["depcruise", "knip", "jscpd"];

function workspacesRepo(rootTools: string[]) {
  const files: Record<string, string> = {
    "harness.config.ts": CONFIG,
    ".gitignore": "node_modules/\n",
    [WEB]: "export const a = 1;\n",
    [PACKAGE]: "export const b = 1;\n",
    "apps/web/node_modules/.bin/next": "",
  };
  for (const tool of rootTools) files[`node_modules/.bin/${tool}`] = "";
  const repo = makeRepo(files);
  return { ...repo, real: fs.realpathSync(repo.root) };
}

const probeStep = (cwd: string) => ({
  name: "eslint-preset",
  cwd,
  command: [process.execPath, CONFIG_RUNNER, "node_modules/.bin/eslint", ...SOURCE_PROBES.map((probe) => probe.replaceAll("{name}", "<probe>"))].join(" "),
});

interface Call {
  name: string;
  cwd: string;
  command: string;
}

function recordSteps(root: string, findings: (step: runner.ToolStep) => ReturnType<typeof runner.runTool> = async () => []): Call[] {
  const calls: Call[] = [];
  const local = (file: string): string => (file.startsWith(`${root}/`) ? path.relative(root, file) : file);
  vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
    calls.push({
      name: step.name,
      cwd: local(step.cwd ?? _root) || ".",
      command: normaliseProbes(step.command.map(local).join(" ")),
    });
    return findings(step);
  });
  return calls;
}

describe("per-workspace Done", () => {
  it("runs each workspace's steps once in its folder with workspace-relative files", async () => {
    const repo = workspacesRepo(ALL_TOOLS);
    const calls = recordSteps(repo.real);
    await doneGate(repo.root, [PACKAGE, WEB]);
    expect(calls).toEqual([
      { name: "next", cwd: "apps/web", command: "apps/web/node_modules/.bin/next typegen" },
      { name: "tsc", cwd: "apps/web", command: "node_modules/.bin/tsc --noEmit --incremental --pretty false" },
      { name: "eslint", cwd: "apps/web", command: "node_modules/.bin/eslint --format json --no-warn-ignored -- src/shared/lib/a.ts" },
      { name: "tsc", cwd: "packages/a", command: "node_modules/.bin/tsc --noEmit --incremental --pretty false" },
      { name: "eslint", cwd: "packages/a", command: "node_modules/.bin/eslint --format json --no-warn-ignored -- src/shared/lib/b.ts" },
      { name: "depcruise", cwd: "apps/web", command: "node_modules/.bin/depcruise src --config .dependency-cruiser.json --output-type json" },
      { name: "knip", cwd: "apps/web", command: "node_modules/.bin/knip --reporter json" },
      {
        name: "jscpd",
        cwd: "apps/web",
        command: expect.stringMatching(/^node_modules\/\.bin\/jscpd src --config \.\.\/\.\.\/tooling\/harness\/presets\/jscpd\.json /) as string,
      },
      { name: "depcruise", cwd: "packages/a", command: "node_modules/.bin/depcruise src --config .dependency-cruiser.json --output-type json" },
      { name: "knip", cwd: "packages/a", command: "node_modules/.bin/knip --reporter json" },
      { name: "jscpd", cwd: "packages/a", command: expect.stringMatching(/ --config \.\.\/\.\.\/tooling\/harness\/presets\/jscpd\.json /) as string },
      { name: "vitest", cwd: "apps/web", command: "node_modules/.bin/vitest related --run --passWithNoTests src/shared/lib/a.ts" },
      { name: "vitest", cwd: "packages/a", command: "node_modules/.bin/vitest related --run --passWithNoTests src/shared/lib/b.ts" },
    ]);
  });

  it("checks the preset in a workspace whose own or ancestor tool config or package.json changed, and everywhere when harness.config.ts did", async () => {
    const repo = workspacesRepo(ALL_TOOLS);
    const calls = recordSteps(repo.real);
    const presetCalls = () => calls.filter(({ name }) => name === "eslint-preset");
    await doneGate(repo.root, [WEB, "apps/web/eslint.config.mjs"]);
    expect(presetCalls()).toEqual([probeStep("apps/web")]);
    calls.length = 0;
    await doneGate(repo.root, [PACKAGE, "packages/a/package.json"]);
    expect(presetCalls()).toEqual([probeStep("packages/a")]);
    calls.length = 0;
    await doneGate(repo.root, ["apps/web/tsconfig.json", "packages/a/src/eslint.config.ts"]);
    expect(presetCalls()).toEqual([]);
    calls.length = 0;
    await doneGate(repo.root, [WEB, "eslint.config.ts"]);
    expect(presetCalls()).toEqual([probeStep("apps/web"), probeStep("packages/a")]);
    calls.length = 0;
    await doneGate(repo.root, ["packages/prettier.config.ts"]);
    expect(presetCalls()).toEqual([probeStep("packages/a")]);
    calls.length = 0;
    await doneGate(repo.root, ["harness.config.ts"]);
    expect(presetCalls()).toEqual([probeStep("apps/web"), probeStep("packages/a")]);
  });

  it("maps tool findings back to git-root paths", async () => {
    const repo = workspacesRepo(ALL_TOOLS);
    recordSteps(repo.real, async (step) => {
      if (step.cwd !== path.join(repo.real, "packages/a")) return [];
      if (step.name === "tsc") return step.findings("src/shared/lib/b.ts(1,14): error TS2322: Type mismatch.\n", 2);
      if (step.name === "eslint") {
        const output = [{ filePath: path.join(repo.real, PACKAGE), messages: [{ ruleId: "no-unused-vars", severity: 2, message: "Unused.", line: 1 }] }];
        return step.findings(JSON.stringify(output), 1);
      }
      return [];
    });
    const result = await doneGate(repo.root, [PACKAGE, WEB]);
    expect(result.passed).toBe(false);
    expect(result.findings.map(({ rule, file, line }) => `${file}:${String(line)} ${rule}`)).toEqual([`${PACKAGE}:1 TS2322`, `${PACKAGE}:1 no-unused-vars`]);
  });

  it("skips tests without a reachable vitest and fails a missing tsc", async () => {
    const repo = workspacesRepo(["eslint", "prettier", ...ANALYSIS]);
    const calls = recordSteps(repo.real);
    const result = await doneGate(repo.root, [PACKAGE]);
    expect(calls.map(({ name, cwd }) => `${cwd} ${name}`)).toEqual(["packages/a eslint", "packages/a depcruise", "packages/a knip", "packages/a jscpd"]);
    expect(result.findings).toEqual([
      { rule: "tsc-failed", file: "", message: "tsc not found from packages/a; install the tools `node tooling/harness/cli.ts init` lists for that workspace" },
    ]);
  });

  it("reports a CI test step without a reachable vitest as skipped", async () => {
    const repo = workspacesRepo(["tsc", "eslint", "prettier", ...ANALYSIS]);
    const calls = recordSteps(repo.real);
    const result = await ciGate(repo.real);
    expect(calls.some(({ name }) => name === "vitest")).toBe(false);
    expect(result.report).toContain("vitest (apps/web): skipped\nvitest (packages/a): skipped");
    expect(result.passed).toBe(true);
  });
});

describe("per-workspace CI and fast gates", () => {
  it("runs every workspace's checks once and no build outside a root Next workspace", async () => {
    const repo = workspacesRepo([...ALL_TOOLS, "playwright"]);
    const calls = recordSteps(repo.real);
    const result = await ciGate(repo.real);
    expect(calls.map(({ name, cwd }) => `${cwd} ${name}`)).toEqual([
      "apps/web prettier",
      "apps/web eslint",
      "apps/web eslint-preset",
      "apps/web typegen",
      "apps/web tsc",
      "packages/a prettier",
      "packages/a eslint",
      "packages/a eslint-preset",
      "packages/a tsc",
      "apps/web depcruise",
      "apps/web knip",
      "apps/web jscpd",
      "packages/a depcruise",
      "packages/a knip",
      "packages/a jscpd",
      "apps/web vitest",
      "packages/a vitest",
    ]);
    expect(result.report).toContain("eslint (packages/a): passed");
  });

  it("formats and lints each workspace's edited files in its folder", async () => {
    const repo = workspacesRepo(ALL_TOOLS);
    const calls = recordSteps(repo.real);
    await fastGate(repo.root, [WEB, PACKAGE]);
    expect(calls.map(({ name, cwd, command }) => `${cwd} ${name} ${command.split(" ").at(-1) ?? ""}`)).toEqual([
      "apps/web prettier src/shared/lib/a.ts",
      "apps/web eslint src/shared/lib/a.ts",
      "packages/a prettier src/shared/lib/b.ts",
      "packages/a eslint src/shared/lib/b.ts",
    ]);
  });
});
