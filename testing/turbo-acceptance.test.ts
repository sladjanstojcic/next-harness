import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../core/gates/ci-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { initHarness } from "../core/init/init.ts";
import { eslintPreset } from "../tools/eslint-preset.ts";
import { placeStep } from "../tools/tool-set.ts";
import { run } from "./preset-fixture.ts";
import type { RepoFixture } from "./temp-repo.ts";
import { consumerRepo } from "./template-repo.ts";
import { TURBO_FILES, TURBO_UI_ESLINT, turboRepo } from "./turbo-repo.ts";

afterEach(() => vi.restoreAllMocks());

const BILLING = "packages/billing";
const LAYOUT = "(package layout)";
const PRICE = `${BILLING}/src/domain/price.ts`;
const PRICE_SOURCE = "export const double = (cents: number): number => cents * 2;\n";
const PRICE_TEST = 'import { expect, it } from "vitest";\nimport { double } from "./price";\n\nit("doubles", () => expect(double(1)).toBe(2));\n';

function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "turbo", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", input: Record<string, unknown>) => send(hook, { tool_name: "Write", tool_input: input });
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    before: (file: string) => tool("PreToolUse", { file_path: file, content: "" }),
    /** PreToolUse, the write itself when allowed, then PostToolUse. */
    async write(file: string, text: string) {
      const input = { file_path: path.join(repo.root, file), content: text };
      const pre = await tool("PreToolUse", input);
      if (pre.kind !== "allow") return pre;
      repo.write(file, text);
      return tool("PostToolUse", input);
    },
  };
}

/** Every tool step the gates start, as `name cwd`, with the runner stubbed to find nothing. */
function recordSteps(repo: RepoFixture): string[] {
  const steps: string[] = [];
  const real = fs.realpathSync(repo.root);
  vi.spyOn(runner, "runTool").mockImplementation(async (root, step) => {
    steps.push(`${step.name} ${path.relative(real, fs.realpathSync(step.cwd ?? root)) || "."}`);
    return [];
  });
  return steps;
}

describe("a Turborepo with shared packages (create-turbo in miniature)", () => {
  it.each([
    [`${BILLING}/src/utils/x.ts`, "src/components/, server/, domain/, hooks/ or lib/"],
    [`${BILLING}/src/actions/save-price-action.ts`, "apps/<app>/src/modules/<module>/actions/<name>-action.ts"],
    ["packages/invoices/src/helpers/x.ts", "src/components/, server/, domain/, hooks/ or lib/"],
    ["packages/ui/src/tooltip.tsx", "src/components/, server/, domain/, hooks/ or lib/"],
    ["packages/eslint-config/rules/x.js", "no folder but src/"],
    ["packages/eslint-config/vue.js", "no JavaScript"],
    ["packages/newlogic/index.js", "no JavaScript"],
  ])("denies a write to %s with the package's own words", async (file, advice) => {
    const outcome = await session(turboRepo()).before(file);
    expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
    const reason = outcome.kind === "deny" ? outcome.reason : "";
    expect(reason).toContain(advice);
    expect(reason).toContain(LAYOUT);
  });

  it.each([
    PRICE,
    "packages/eslint-config/base.js",
    "packages/typescript-config/nextjs.json",
    "packages/invoices/src/index.ts",
    "packages/ui/src/components/tooltip.tsx",
  ])("allows a write to %s", async (file) => {
    expect(await session(turboRepo()).before(file)).toEqual({ kind: "allow" });
  });

  it("keeps the app on the next-modules shape", async () => {
    const outcome = await session(turboRepo()).before("apps/web/src/utils/x.ts");
    expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
    expect(outcome.kind === "deny" ? outcome.reason : "").not.toContain(LAYOUT);
  });

  it("blocks a domain file without its test at Stop, runs the package's own tools there, and passes once the test exists", async () => {
    const repo = turboRepo();
    const steps = recordSteps(repo);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(PRICE, PRICE_SOURCE)).toEqual({ kind: "allow" });
    steps.length = 0;
    const stop = await hooks.stop();
    expect(stop.kind).toBe("block");
    expect(stop.findings?.map(({ file, rule }) => `${file} ${rule}`)).toEqual([`${PRICE} domain-test`]);
    expect(stop.findings?.[0]?.message).toContain(`${BILLING}/src/domain/price.test.ts ${LAYOUT}`);
    expect(steps).toEqual([`tsc ${BILLING}`, `eslint ${BILLING}`, `vitest ${BILLING}`]);
    expect(await hooks.write(`${BILLING}/src/domain/price.test.ts`, PRICE_TEST)).toEqual({ kind: "allow" });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });

  it("runs no tool in a config-only package and no analysis in any package", async () => {
    const repo = turboRepo();
    const steps = recordSteps(repo);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write("packages/eslint-config/base.js", "export const config = [{}];\n")).toEqual({ kind: "allow" });
    steps.length = 0;
    expect(await hooks.stop()).toEqual({ kind: "allow" });
    expect(steps).toEqual([]);
    await ciGate(repo.root);
    const inPackages = steps.filter((step) => step.includes(" packages/"));
    expect(inPackages.filter((step) => !step.endsWith(BILLING) && !step.endsWith("packages/ui"))).toEqual([]);
    expect(inPackages.filter((step) => step.endsWith(BILLING))).toEqual(
      ["prettier", "eslint", "eslint-preset", "tsc", "vitest"].map((name) => `${name} ${BILLING}`),
    );
    expect(steps).toContain("depcruise apps/web");
  });
});

describe("init in that Turborepo", () => {
  it("writes each package's thin configs, keeps create-turbo's own, and the preset holds in the package", async () => {
    const repo = consumerRepo({ ...TURBO_FILES });
    const result = initHarness(repo.root, { force: false, starter: false });
    expect(result.ok, result.report).toBe(true);
    const exists = (file: string): boolean => fs.existsSync(path.join(repo.root, file));
    expect(repo.read(`${BILLING}/eslint.config.ts`)).toContain('harnessEslint({ root: import.meta.dirname, layout: "package" })');
    expect(["prettier.config.ts", "vitest.config.ts"].every((file) => exists(`${BILLING}/${file}`))).toBe(true);
    expect([".dependency-cruiser.json", "knip.config.ts", ".gitignore", ".prettierignore"].filter((file) => exists(`${BILLING}/${file}`))).toEqual([]);
    const { scripts, exports } = JSON.parse(repo.read(`${BILLING}/package.json`)) as { scripts: Record<string, string>; exports: object };
    expect(scripts).toEqual({ lint: "eslint . --max-warnings 0", typecheck: "tsc --noEmit", test: "vitest run", format: "prettier --write ." });
    expect(Object.keys(exports)).toEqual([".", "./server"]);
    expect((JSON.parse(repo.read(`${BILLING}/tsconfig.json`)) as { exclude: string[] }).exclude).toEqual(
      expect.arrayContaining(["eslint.config.ts", "prettier.config.ts", "vitest.config.ts"]),
    );
    expect(repo.read("packages/ui/eslint.config.mjs")).toBe(TURBO_UI_ESLINT);
    expect(exists("packages/ui/eslint.config.ts")).toBe(false);
    expect(result.report).toContain("kept packages/ui/eslint.config.mjs: your config stays; add the harness preset to it");
    expect(result.report).toContain('...harnessEslint({ root: import.meta.dirname, layout: "package" }),');
    expect(fs.readdirSync(path.join(repo.root, "packages/eslint-config")).sort()).toEqual([
      "README.md",
      "base.js",
      "next.js",
      "package.json",
      "react-internal.js",
    ]);
    expect(result.report).not.toContain("packages/typescript-config");

    const dir = path.join(repo.root, BILLING);
    const step = placeStep(repo.root, BILLING, eslintPreset(dir, { path: BILLING, shape: "package", next: false }));
    expect("finding" in step ? step.finding : await runner.runTool(repo.root, step)).toEqual([]);

    repo.write(PRICE, PRICE_SOURCE);
    repo.write(
      `${BILLING}/src/domain/tax.ts`,
      'import { readFileSync } from "node:fs";\nimport { getPrices } from "../server";\n\nexport const tax = [readFileSync, getPrices];\n',
    );
    repo.write(`${BILLING}/src/domain/vat.ts`, 'import { getPrices } from "../server.js";\n\nexport const vat = getPrices;\n');
    repo.write(`${BILLING}/src/lib/unsafe.ts`, "export const unsafe: any = 1;\n");
    const clean = run(dir, "eslint", ["src/domain/price.ts", "src/server.ts", "--max-warnings", "0"]);
    expect(clean.status, clean.output).toBe(0);
    const lint = run(dir, "eslint", ["src/domain/tax.ts", "src/domain/vat.ts", "src/lib/unsafe.ts"]);
    expect(lint.status, lint.output).toBe(1);
    expect(lint.output.match(/no-restricted-imports/g)).toHaveLength(3);
    expect(lint.output).toContain("Keep src/domain/ pure");
    expect(lint.output).toContain("@typescript-eslint/no-explicit-any");
  }, 120_000);
});
