import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { STARTER_HELPERS } from "../shapes/next-probes.ts";
import { depcruise } from "../tools/analysis.ts";
import { eslintPreset } from "../tools/eslint-preset.ts";
import { APP, APP_WITHOUT_SRC, initialised, run } from "./preset-fixture.ts";
import { makeRepo, type RepoFixture } from "./temp-repo.ts";

afterEach(() => vi.restoreAllMocks());

const WORKSPACE = { path: "", shape: "next-modules", tools: "eslint-prettier", next: true, sourceRoot: "" } as const;
const PRICE = "modules/billing/domain/price.ts";
const PRICE_SOURCE = "export const double = (cents: number): number => cents * 2;\n";
const PRICE_TEST = 'import { expect, it } from "vitest";\nimport { double } from "./price";\n\nit("doubles", () => expect(double(1)).toBe(2));\n';
const PROXY = 'import { adapt } from "./modules/billing/server/adapter";\n\nexport const proxy = adapt;\n';
const TOOLS = Object.fromEntries(
  ["eslint", "prettier", "tsc", "next", "vitest", "depcruise", "knip", "jscpd"].map((tool) => [`node_modules/.bin/${tool}`, ""]),
);

function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "root-layout", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", input: Record<string, unknown>) => send(hook, { tool_name: "Write", tool_input: input });
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    before: (file: string) => tool("PreToolUse", { file_path: file, content: "" }),
    async write(file: string, text: string) {
      const input = { file_path: path.join(repo.root, file), content: text };
      const pre = await tool("PreToolUse", input);
      if (pre.kind !== "allow") return pre;
      repo.write(file, text);
      return tool("PostToolUse", input);
    },
  };
}

describe("create-next-app without --src-dir, with no harness.config.ts", () => {
  const project = () => makeRepo({ ...APP_WITHOUT_SRC, ".gitignore": "node_modules/\n.next/\n", ...TOOLS });

  it.each(["app/reports/page.tsx", "app/api/orders/route.ts", PRICE, "modules/billing/index.ts", "shared/lib/money.ts", "proxy.ts"])(
    "allows a write to %s",
    async (file) => {
      expect(await session(project()).before(file)).toEqual({ kind: "allow" });
    },
  );

  it.each(["utils/x.ts", "components/button.tsx", "src/app/x/page.tsx", "src/modules/billing/index.ts", "src/shared/lib/x.ts"])(
    "denies a write to %s and names the folders beside app/",
    async (file) => {
      const outcome = await session(project()).before(file);
      expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
      expect(outcome.kind === "deny" ? outcome.reason : "").toContain("routes belong in app/, feature code in modules/<module>/, shared code in shared/");
    },
  );

  it.each(["app/reports/page.tsx", "modules/billing/index.ts", "shared/lib/money.ts", "proxy.ts"])(
    "a project with src/app/ still denies %s at its top, so no write can switch the layout",
    async (file) => {
      const outcome = await session(makeRepo({ ...APP, ...TOOLS })).before(file);
      expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
      expect(outcome.kind === "deny" ? outcome.reason : "").toContain("application code belongs in src/");
    },
  );

  it.each([
    ["create-next-app without --src-dir", APP_WITHOUT_SRC, "src/app", ["app/y/page.tsx"], ["src/app/x/page.tsx"]],
    [
      "src/modules/ and src/shared/ but no src/app/ yet",
      { "src/modules/a/index.ts": "", "src/shared/lib/a.ts": "" },
      "app",
      ["src/modules/a/server.ts"],
      ["app/page.tsx"],
    ],
    ["an empty project", { "package.json": "{}\n" }, "app", ["src/app/page.tsx"], ["app/page.tsx"]],
  ])("in %s an empty folder from mkdir does not switch the layout", async (_name, files, folder, allowed, denied) => {
    const repo = makeRepo({ ...files, ...TOOLS });
    const hooks = session(repo);
    const decide = async (): Promise<string[]> => {
      const outcomes: string[] = [];
      for (const file of [...allowed, ...denied]) outcomes.push(`${file} ${(await hooks.before(file)).kind}`);
      return outcomes;
    };
    const expected = [...allowed.map((file) => `${file} allow`), ...denied.map((file) => `${file} deny`)];
    expect(await decide()).toEqual(expected);
    fs.mkdirSync(path.join(repo.root, folder), { recursive: true });
    expect(await decide()).toEqual(expected);
  });

  it("does not take a file named app, or an ignored one under app/, for the app folder", async () => {
    const named = makeRepo({ "package.json": "{}\n", app: "not a folder\n", ...TOOLS });
    expect(await session(named).before("src/app/page.tsx")).toEqual({ kind: "allow" });
    const ignored = makeRepo({ "package.json": "{}\n", ".gitignore": "app/cache.tmp\n", ...TOOLS });
    ignored.write("app/cache.tmp", "");
    expect(await session(ignored).before("src/app/page.tsx")).toEqual({ kind: "allow" });
    ignored.write("app/page.tsx", "");
    expect(await session(ignored).before("src/app/page.tsx")).toMatchObject({ kind: "deny" });
  });

  it("asks at Stop for the test of a new domain rule, runs the analysis on the folders at the top, and passes with the test", async () => {
    const repo = project();
    const steps: string[] = [];
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
      if (step.name === "depcruise" || step.name === "jscpd") steps.push(step.command.slice(1, step.command.indexOf("--config")).join(" "));
      return [];
    });
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(PRICE, PRICE_SOURCE)).toEqual({ kind: "allow" });
    const stop = await hooks.stop();
    expect(stop.kind).toBe("block");
    expect(stop.findings).toEqual([
      { rule: "domain-test", file: PRICE, line: 1, message: "Put the domain rule's test beside it at modules/billing/domain/price.test.ts." },
    ]);
    expect(steps).toEqual(["app modules", "app modules"]);
    expect(await hooks.write("modules/billing/domain/price.test.ts", PRICE_TEST)).toEqual({ kind: "allow" });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });
});

describe("init --starter in that project", () => {
  it("puts the helpers in shared/lib/, writes configs for the layout, and the real ESLint and dependency-cruiser hold its rules", async () => {
    const repo = initialised(APP_WITHOUT_SRC, true);
    const exists = (file: string): boolean => fs.existsSync(path.join(repo.root, file));
    expect(STARTER_HELPERS.filter((file) => !exists(`shared/lib/${file}`))).toEqual([]);
    expect(exists("src")).toBe(false);
    expect(repo.report).not.toContain("turbo.json");
    expect(repo.read("eslint.config.ts")).toContain('harnessEslint({ root: import.meta.dirname, layout: "app-root", next: true })');
    expect(repo.read(".prettierignore")).toContain("shared/ui\n");
    expect(repo.read(".prettierignore")).not.toContain("src/");
    const { scripts } = JSON.parse(repo.read("package.json")) as { scripts: Record<string, string> };
    expect(scripts.depcruise).toBe("depcruise app shared --config .dependency-cruiser.json");
    expect(scripts.jscpd).toBe("jscpd app shared --config ./tooling/harness/presets/jscpd.json");

    expect(await runner.runTool(repo.root, eslintPreset(repo.root, WORKSPACE))).toEqual([]);
    repo.write("modules/billing/index.ts", "export const billing = 1;\n");
    repo.write("modules/billing/server/adapter.ts", 'import "server-only";\n\nexport const adapt = (value: unknown): number => value as number;\n');
    repo.write("shared/lib/cast.ts", "export const cast = (value: unknown): number => value as number;\n");
    const adapter = run(repo.root, "eslint", ["modules/billing/server/adapter.ts", "shared/lib/log.ts", "--max-warnings", "0"]);
    expect(adapter.status, adapter.output).toBe(0);
    const cast = run(repo.root, "eslint", ["shared/lib/cast.ts"]);
    expect(cast.output).toContain("@typescript-eslint/no-unsafe-type-assertion");

    repo.write("shared/lib/uses-module.ts", 'import { billing } from "../../modules/billing/index";\n\nexport const usesModule = billing;\n');
    repo.write("modules/cart/index.ts", 'import { adapt } from "@/modules/billing/server/adapter";\n\nexport const cart = adapt;\n');
    repo.write("proxy.ts", PROXY);
    const findings = await runner.runTool(
      repo.root,
      depcruise.report(repo.root, WORKSPACE, new Set(), () => undefined),
    );
    expect(findings.map(({ file, rule }) => `${file} ${rule}`).sort()).toEqual([
      "modules/cart/index.ts module-public-api",
      "proxy.ts module-public-api",
      "shared/lib/uses-module.ts shared-not-modules",
    ]);
    expect(findings.find(({ rule }) => rule === "shared-not-modules")?.message).toContain("cross-cutting code belongs in shared/lib/.");
  }, 120_000);

  it("with src/, the same proxy.ts is the same finding", async () => {
    const repo = initialised(APP);
    repo.write("src/modules/billing/server/adapter.ts", 'import "server-only";\n\nexport const adapt = (value: unknown): number => value as number;\n');
    repo.write("src/proxy.ts", PROXY);
    const findings = await runner.runTool(
      repo.root,
      depcruise.report(repo.root, { ...WORKSPACE, sourceRoot: "src/" }, new Set(), () => undefined),
    );
    expect(findings.map(({ file, rule }) => `${file} ${rule}`)).toEqual(["src/proxy.ts module-public-api"]);
  }, 120_000);
});
