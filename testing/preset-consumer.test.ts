import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP, initialised, presetFindings, run } from "./preset-fixture.ts";

describe("a create-next-app project after init", () => {
  it("lints with the harness rules and passes the presence check", async () => {
    const repo = initialised({
      ...APP,
      "src/modules/orders/components/bad.ts": [
        "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
        "export const unsafe: any = 1;",
        "Promise.resolve(1);",
        "// @ts-ignore",
        "export const ignored: number = 'text';",
        ...Array<string>(250).fill("// counted"),
      ].join("\n"),
    });
    const lint = run(repo.root, "eslint", ["src/modules/orders/components/bad.ts", "--max-warnings", "0"]);
    expect(lint.status, lint.output).toBe(1);
    for (const rule of ["no-explicit-any", "no-floating-promises", "ban-ts-comment", "max-lines"]) expect(lint.output).toContain(rule);
    expect(lint.output).toContain("no effect because you have 'noInlineConfig'");
    expect(await presetFindings(repo.root)).toEqual([]);
  }, 120_000);

  it("type-checks and lints clean with create-next-app's tsconfig, neither judging the vendored harness", () => {
    const repo = initialised(APP);
    const tsconfig = JSON.parse(repo.read("tsconfig.json")) as { compilerOptions: Record<string, unknown>; exclude: string[] };
    expect(tsconfig.compilerOptions.allowImportingTsExtensions).toBe(true);
    expect(tsconfig.exclude).toEqual(["node_modules", "tooling/harness"]);
    const tsc = run(repo.root, "tsc", ["--noEmit"]);
    expect(tsc.status, tsc.output).toBe(0);
    const lint = run(repo.root, "eslint", [".", "--max-warnings", "0"]);
    expect(lint.status, lint.output).toBe(0);
    expect(repo.report).toContain("formatted ");
    expect(repo.report.split("\n").at(-1)).toBe("Then format the app's own files once in the preset's style: prettier --write .");
    const format = run(repo.root, "prettier", ["--check", "."]);
    expect(format.status, format.output).toBe(0);
    const lockfile = run(repo.root, "prettier", ["--check", "--ignore-path", "", "pnpm-lock.yaml"]);
    expect(lockfile.status, "the fixture's lockfile must be one Prettier would rewrite").toBe(1);
  }, 120_000);

  it("passes Vitest before the first test, and Playwright runs only e2e/ tests, the starter smoke test among them", () => {
    const sample = { "tooling/harness/sample.test.ts": 'import { it } from "vitest";\nit("is the harness\'s", () => undefined);\n' };
    const fresh = initialised({ ...APP, ...sample });
    const tests = run(fresh.root, "vitest", ["run"]);
    expect(tests.status, tests.output).toBe(0);
    expect(tests.output).toContain("No test files found");
    const repo = initialised({ ...APP, ...sample }, true);
    expect(repo.read("playwright.config.ts")).toBe(
      'import { harnessPlaywright } from "./tooling/harness/presets/playwright.ts";\n\nexport default harnessPlaywright();\n',
    );
    const browser = run(repo.root, "playwright", ["test", "--list"]);
    expect(browser.status, browser.output).toBe(0);
    expect(browser.output).toContain("e2e/smoke.test.ts");
    expect(browser.output).toContain("Total: 1 test in 1 file");
  }, 120_000);

  it("collects the project's tests but not the harness's, and knip skips harness exports", () => {
    const repo = initialised({
      ...APP,
      "src/shared/lib/sum.ts": "export const sum = (a: number, b: number): number => a + b;\n",
      "src/shared/lib/sum.test.ts": 'import { expect, it } from "vitest";\nimport { sum } from "./sum";\nit("adds", () => expect(sum(1, 2)).toBe(3));\n',
      "tooling/harness/sample.test.ts": 'import { it } from "vitest";\nit("is the harness\'s", () => undefined);\n',
      "tooling/harness/unused.ts": "export const harnessOnly = 1;\n",
    });
    const tests = run(repo.root, "vitest", ["list", "--filesOnly"]);
    expect(tests.status, tests.output).toBe(0);
    expect(tests.output).toContain("src/shared/lib/sum.test.ts");
    expect(tests.output).not.toContain("tooling/harness");
    const knip = run(repo.root, "knip", ["--reporter", "json"]);
    expect(knip.output).toContain('{"issues":[');
    expect(knip.output).not.toContain("tooling/harness");
    expect(knip.output).not.toContain("harnessOnly");
  }, 120_000);
});

describe("a nested next-modules workspace after init", () => {
  it("blocks a deep cross-module import with the preset's boundaries", () => {
    const repo = initialised({
      "harness.config.ts": 'export default { workspaces: [{ path: "apps/dashboard", shape: "next-modules", next: true }], root: { entries: ["apps"] } };\n',
      "apps/dashboard/package.json": "{}\n",
      ...Object.fromEntries(Object.entries(APP).map(([file, text]) => [`apps/dashboard/${file}`, text])),
      "apps/dashboard/src/modules/billing/server/invoice.ts": "export const invoice = 1;\n",
      "apps/dashboard/src/modules/billing/index.ts": "export const billing = 1;\n",
      "apps/dashboard/src/modules/orders/components/total.ts": 'export { invoice } from "@/modules/billing/server/invoice";\n',
    });
    const dashboard = path.join(repo.root, "apps/dashboard");
    const cruise = run(dashboard, "depcruise", ["src", "--config", ".dependency-cruiser.json", "--output-type", "err-long"]);
    expect(cruise.status, cruise.output).toBe(1);
    expect(cruise.output).toContain("module-public-api");
    expect(cruise.output).toContain("src/modules/orders/components/total.ts");
  }, 120_000);
});
