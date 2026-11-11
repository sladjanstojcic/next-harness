import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../core/gates/ci-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import type { RepoFixture } from "./temp-repo.ts";
import { turboRepo } from "./turbo-repo.ts";

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
    [`${BILLING}/src/actions/save-price-action.ts`, "under apps/<app>/, in modules/<module>/actions/<name>-action.ts"],
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
    "apps/web/README.md",
    "apps/web/.gitignore",
    "apps/web/AGENTS.md",
    "apps/docs/app/reports/page.tsx",
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
    expect(steps).toEqual(["tsc", "eslint", "depcruise", "knip", "jscpd", "vitest"].map((name) => `${name} ${BILLING}`));
    expect(await hooks.write(`${BILLING}/src/domain/price.test.ts`, PRICE_TEST)).toEqual({ kind: "allow" });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });

  it("runs no tool in a config-only package, and the analysis tools in a package with src/", async () => {
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
      ["prettier", "eslint", "eslint-preset", "tsc", "depcruise", "knip", "jscpd", "vitest"].map((name) => `${name} ${BILLING}`),
    );
    expect(steps).toContain("depcruise apps/web");
  });
});
