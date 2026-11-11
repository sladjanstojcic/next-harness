import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../core/audit/audit.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { knip } from "../tools/analysis.ts";
import { eslintPrettier } from "../tools/eslint-prettier.ts";
import { placeStep } from "../tools/tool-set.ts";
import { APP, APP_WITHOUT_SRC } from "./preset-fixture.ts";
import { makeRepo, type RepoFixture } from "./temp-repo.ts";
import { consumerRepo } from "./template-repo.ts";
import { linkWorkspacePackages, TURBO_FILES, turboRepo } from "./turbo-repo.ts";

afterEach(() => vi.restoreAllMocks());

const NEW = "packages/invoices";
const STRICT = '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src"] }\n';
const CONFIGS: Record<string, string> = {
  "tsconfig.json": STRICT,
  "eslint.config.ts":
    'import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, layout: "package" });\n',
  "vitest.config.ts": 'import { harnessVitest } from "../../tooling/harness/presets/vitest.ts";\n\nexport default harnessVitest();\n',
  "prettier.config.ts": 'export { default } from "../../tooling/harness/presets/prettier.ts";\n',
};

function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "new-workspace", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", name: string, input: Record<string, unknown>) => send(hook, { tool_name: name, tool_input: input });
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    async write(file: string, text: string) {
      const input = { file_path: path.join(repo.root, file), content: text };
      const pre = await tool("PreToolUse", "Write", input);
      if (pre.kind !== "allow") return pre;
      repo.write(file, text);
      return tool("PostToolUse", "Write", input);
    },
    async shell(command: string, change: () => void) {
      const pre = await tool("PreToolUse", "Bash", { command });
      if (pre.kind !== "allow") return pre;
      change();
      return tool("PostToolUse", "Bash", { command });
    },
  };
}

describe("a new workspace: its tool configs may be created, not changed once committed", () => {
  it("lets an agent write and rewrite the configs of a package with no file at HEAD, by tool and by shell", async () => {
    const repo = turboRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(`${NEW}/package.json`, '{ "name": "@repo/invoices" }\n')).toEqual({ kind: "allow" });
    for (const [file, text] of Object.entries(CONFIGS)) expect(await hooks.write(`${NEW}/${file}`, text), file).toEqual({ kind: "allow" });
    expect(await hooks.write(`${NEW}/tsconfig.json`, STRICT.replace('"noEmit": true', '"noEmit": true, "jsx": "react-jsx"'))).toEqual({ kind: "allow" });
    const init = () => repo.write(`${NEW}/vitest.config.ts`, `${CONFIGS["vitest.config.ts"] ?? ""}\n`);
    expect(await hooks.shell("node tooling/harness/cli.ts init", init)).toEqual({ kind: "allow" });
    expect(await hooks.write(`${NEW}/src/index.ts`, "export const invoices = 1;\n")).toEqual({ kind: "allow" });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });

  it("locks them from the commit that gives the workspace a file at HEAD", async () => {
    const repo = turboRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    for (const [file, text] of Object.entries(CONFIGS)) await hooks.write(`${NEW}/${file}`, text);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "a new package");
    for (const file of Object.keys(CONFIGS))
      expect(await hooks.write(`${NEW}/${file}`, "changed\n"), file).toMatchObject({ kind: "deny", guard: "harness-lock" });
    const edited = await hooks.shell("sed -i '' 's/true/false/' tsconfig.json", () => repo.write(`${NEW}/tsconfig.json`, STRICT.replace("true", "false")));
    expect(edited).toMatchObject({ kind: "block", findings: [{ rule: "harness-lock", file: `${NEW}/tsconfig.json` }] });
  });

  it("keeps an existing workspace's configs, harness.config.ts and a locked path in the new folder closed", async () => {
    const repo = turboRepo({ "harness.config.ts": TURBO_FILES["harness.config.ts"]?.replace("legacy:", `locked: ["${NEW}/turbo.json"],\n  legacy:`) ?? "" });
    const hooks = session(repo);
    await hooks.prompt();
    for (const file of ["packages/ui/tsconfig.json", "packages/ui/eslint.config.mjs", "apps/web/tsconfig.json", "harness.config.ts", `${NEW}/turbo.json`])
      expect(await hooks.write(file, "{}\n"), file).toMatchObject({ kind: "deny", guard: "harness-lock" });
  });

  it("blocks a new package whose tsconfig switches the type check off", async () => {
    const repo = turboRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(`${NEW}/tsconfig.json`, '{ "compilerOptions": { "strict": false } }\n')).toEqual({ kind: "allow" });
    const stop = await hooks.stop();
    expect(stop.kind).toBe("block");
    expect(stop.findings).toEqual([expect.objectContaining({ rule: "tsconfig-strict", file: `${NEW}/tsconfig.json` })]);
    expect(stop.findings?.[0]?.message).toContain("compilerOptions.strict is off");
    expect(await hooks.write(`${NEW}/tsconfig.json`, '{ "compilerOptions": { "strict": true, "strictNullChecks": false } }\n')).toEqual({ kind: "allow" });
    expect((await hooks.stop()).findings?.[0]?.message).toContain("compilerOptions.strictNullChecks is off");
  });
});

describe("the tsconfig check", () => {
  const strictness = (root: string): string[] =>
    audit(root)
      .filter(({ rule }) => rule === "tsconfig-strict")
      .map(({ file, message }) => `${file} ${message.split(" ")[0] ?? ""}`);

  it("finds nothing in this template, create-next-app's project, or create-turbo's with its base config", () => {
    expect(strictness(path.resolve(import.meta.dirname, "../../.."))).toEqual([]);
    expect(strictness(makeRepo(APP).root)).toEqual([]);
    expect(strictness(makeRepo(APP_WITHOUT_SRC).root)).toEqual([]);
    const turbo = makeRepo({ ...TURBO_FILES });
    linkWorkspacePackages(turbo.root);
    expect(strictness(turbo.root)).toEqual([]);
  });

  it("names each option that is off, read through extends, and skips a chain it cannot read", () => {
    const config =
      'export default { workspaces: [{ path: "apps/*", shape: "next-modules" }, { path: "packages/*", shape: "package" }], root: { entries: ["apps", "packages", "base.json"] } };\n';
    const repo = makeRepo({
      "harness.config.ts": config,
      "base.json": '{ "compilerOptions": { "strict": true, "noImplicitAny": false } }\n',
      "apps/a/tsconfig.json": '{ "extends": "../../base.json" }\n',
      "apps/b/tsconfig.json": '{ "compilerOptions": { "skipLibCheck": true } }\n',
      "apps/c/tsconfig.json": '{ "extends": "@repo/not-installed/base.json" }\n',
      "packages/d/tsconfig.json": '{ "extends": "../../base.json", "compilerOptions": { "noImplicitAny": true, "skipLibCheck": true } }\n',
      "packages/e/package.json": "{}\n",
    });
    expect(strictness(repo.root)).toEqual(["apps/a/tsconfig.json compilerOptions.noImplicitAny", "apps/b/tsconfig.json compilerOptions.strict"]);
  });
});

describe("messages an agent gets from the tools", () => {
  it("say in one line that a workspace has no ESLint config, with the command that creates it", async () => {
    const repo = consumerRepo({ "packages/invoices/package.json": "{}\n", "packages/invoices/src/index.ts": "export const invoices = 1;\n" });
    const dir = path.join(repo.root, NEW);
    const step = placeStep(repo.root, NEW, eslintPrettier.lint.files(dir, ["src/index.ts"], false));
    const findings = "finding" in step ? [step.finding] : await runner.runTool(repo.root, step);
    expect(findings).toEqual([
      {
        rule: "eslint-failed",
        file: "",
        message:
          "This workspace has no ESLint config (eslint.config.*). Create it with `node tooling/harness/cli.ts init`, which writes the harness's config for every workspace that lacks one.",
      },
    ]);
  }, 60_000);

  it("name what knip found, with its line, instead of knip's JSON", () => {
    const entry = (name: string, line?: number) => ({ name, ...(line === undefined ? {} : { line, col: 15, pos: 71 }) });
    const issue = {
      file: "src/plans.ts",
      types: [entry("PricedPlan", 2)],
      exports: [entry("unused", 9)],
      binaries: [entry("tsc")],
      unresolved: [entry("./gone", 4)],
    };
    const stdout = JSON.stringify({
      issues: [issue, { file: "src/old.ts", files: [entry("src/old.ts")] }, { file: "package.json", dependencies: [entry("zod", 12)] }],
    });
    const findings = knip.report("/repo").findings(stdout, 1);
    expect(findings.map(({ rule, file, line, message }) => `${rule} ${file}:${String(line)} ${message.split(". ")[0] ?? ""}`)).toEqual([
      "knip-types src/plans.ts:2 unused exported type PricedPlan",
      "knip-exports src/plans.ts:9 unused export unused",
      "knip-binaries src/plans.ts:undefined unlisted binary tsc",
      "knip-unresolved src/plans.ts:4 unresolved import ./gone",
      "knip-files src/old.ts:undefined unused file src/old.ts",
      "knip-dependencies package.json:12 unused dependency zod",
    ]);
    expect(findings.every(({ message }) => !message.includes("{"))).toBe(true);
  });
});
