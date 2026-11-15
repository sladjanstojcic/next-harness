import { describe, expect, it } from "vitest";
import { harnessRuleBlocks } from "../presets/eslint-rules.ts";
import { expectedRules } from "../tools/eslint-preset.ts";
import { layoutOf, PRESET_PROBES } from "../tools/eslint/preset-layout.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";

const REQUIRE = "CallExpression[callee.name='require']";
const THIN =
  'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, layout: "e2e" });\n';
const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM"], module: "esnext", moduleResolution: "bundler", strict: true, noEmit: true },
  include: ["tests"],
});

const SPEC = 'import { expect, test } from "@playwright/test";\n\ntest("a", async ({ page }) => {\n  await expect(page.locator("#a")!).toBeVisible();\n});\n';
const SETUP = 'import { test } from "@playwright/test";\n\ntest("setup", async ({ page }) => {\n  await page.locator("#a")!.click();\n});\n';
const PAGE_OBJECT =
  "interface Order {\n  id: string;\n}\n\nexport function readOrder(text: string): Order {\n  const order = JSON.parse(text) as Order;\n  return order;\n}\n";
const LOGGING = 'import { test } from "@playwright/test";\n\ntest("b", () => {\n  console.log(1);\n});\n';
const FIXTURE =
  'import { test as base } from "@playwright/test";\n\nexport const test = base.extend<{ order: string }>({\n  order: async ({ page }, use) => {\n    await use(page.url());\n  },\n});\n';

/** What a local Playwright run leaves in the folder, gitignored, which ESLint does not read: a trace viewer's script, a result. */
const OUTPUT = ["playwright-report/trace/sw.bundle.js", "test-results/a/run.js", "blob-report/a.ts"];

/** One file per case of the brief, with the rule ids ESLint must report there. */
const ROWS: [file: string, code: string, expected: string[]][] = [
  ["tests/a.spec.ts", SPEC, []],
  ["tests/shop/shop.setup.ts", SETUP, []],
  ["tests/shop/order.po.ts", PAGE_OBJECT, ["@typescript-eslint/no-unsafe-type-assertion"]],
  ["tests/b.spec.ts", LOGGING, ["no-console"]],
  ["tests/shop/order-fixture.ts", FIXTURE, []],
];

interface Result {
  filePath: string;
  messages: { ruleId: string | null; message: string }[];
}

describe("the e2e preset layout", () => {
  it("is the layout of an e2e workspace, probed on the shape's own paths", () => {
    expect(layoutOf({ path: "apps/e2e", shape: "e2e", next: false })).toBe("e2e");
    expect(PRESET_PROBES.e2e).toEqual(["tests/{name}.spec.ts", "tests/{name}/{name}.setup.ts", "tests/{name}/{name}.po.ts"]);
  });

  it("lets specs and setup files assert, and holds page objects to the cast rules", () => {
    for (const file of ["tests/a/b.spec.ts", "tests/a/b.setup.ts", "tests/a/b.test.ts"]) {
      const rules = expectedRules(file, "e2e");
      expect(rules["@typescript-eslint/no-non-null-assertion"], file).toBe("off");
      expect(rules["@typescript-eslint/no-unsafe-type-assertion"], file).toBe("off");
    }
    const pageObject = expectedRules("tests/a/b.po.ts", "e2e");
    for (const rule of ["@typescript-eslint/no-non-null-assertion", "@typescript-eslint/no-unsafe-type-assertion", "no-console"])
      expect(pageObject[rule], rule).toBe("error");
    expect(JSON.stringify(pageObject["no-restricted-syntax"])).toContain(JSON.stringify(REQUIRE));
    expect(JSON.stringify(pageObject["no-restricted-syntax"])).toContain("TSAsExpression > TSAsExpression");
  });

  it("has no React hooks block, no console exemption and no raw-control ban", () => {
    const blocks = JSON.stringify(harnessRuleBlocks("e2e", undefined, true));
    expect(blocks).not.toContain("harness-react-hooks/");
    expect(blocks).not.toContain('"no-console":"off"');
    expect(blocks).not.toContain("JSXOpeningElement");
  });

  it("lets a spec assert non-null, reports an unchecked cast in a page object and console in a spec, and skips Playwright's output", () => {
    const { root } = consumerRepo({
      "package.json": JSON.stringify({ name: "e2e", type: "module" }),
      "tsconfig.json": TSCONFIG,
      "eslint.config.ts": THIN,
      ...Object.fromEntries(ROWS.map(([file, code]) => [file, code])),
      ...Object.fromEntries(OUTPUT.map((file) => [file, "var a = b; console.log(a)\n"])),
    });
    const results = JSON.parse(run(root, "eslint", ["-f", "json", ...ROWS.map(([file]) => file), ...OUTPUT]).output) as Result[];
    const found = (file: string) => results.find(({ filePath }) => filePath.endsWith(file))?.messages ?? [{ ruleId: "not linted", message: "" }];
    const ids = (file: string) => [...new Set(found(file).map(({ ruleId }) => ruleId))].sort();
    expect(ROWS.map(([file]) => [file, ids(file)])).toEqual(ROWS.map(([file, , expected]) => [file, [...expected].sort()]));
    for (const file of OUTPUT) {
      const [ignored, ...more] = found(file);
      expect(more, file).toEqual([]);
      expect(ignored?.ruleId, file).toBeNull();
      expect(ignored?.message, file).toMatch(/ignore/i);
    }
  }, 120_000);
});
