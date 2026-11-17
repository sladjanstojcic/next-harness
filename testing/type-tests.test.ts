import { spawnSync } from "node:child_process";
import path from "node:path";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { auditPaths } from "../core/audit/path-rules.ts";
import { listFiles } from "../core/audit/list-files.ts";
import { harnessRuleBlocks, type PresetLayout } from "../presets/eslint-rules.ts";
import { backendModulesIndex } from "../shapes/shape.ts";
import { makeRepo } from "./temp-repo.ts";
import { templateRepo } from "./template-repo.ts";

const LAYOUTS: readonly PresetLayout[] = ["app", "app-root", "package", "electron", "spa", "pocketbase", "e2e", "service"];
const BAN = "@typescript-eslint/ban-ts-comment";
const SOURCE = (directive: string): string => `// ${directive} the value is a string\nexport const value: number = "text";\n`;

/** The ban-ts-comment findings the layout's rule blocks give one file, every other rule left out. */
function banFindings(layout: PresetLayout, file: string, directive: string): string[] {
  const blocks = harnessRuleBlocks(layout).flatMap((block) => {
    const setting = block.rules[BAN];
    return setting === undefined ? [] : [{ ...block, rules: { [BAN]: setting } }];
  });
  const config: Linter.Config[] = [
    { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser }, plugins: { "@typescript-eslint": tseslint.plugin } },
    ...blocks,
  ];
  return new Linter({ cwd: process.cwd() })
    .verify(SOURCE(directive), config, path.join(process.cwd(), file))
    .map((message) => `${message.ruleId ?? "parse"}: ${message.message}`);
}

describe("type tests (*.test-d.ts)", () => {
  it.each(LAYOUTS)("may use @ts-expect-error, and only that directive, in the %s layout", (layout) => {
    expect(banFindings(layout, "src/types/foo.test-d.ts", "@ts-expect-error")).toEqual([]);
    expect(banFindings(layout, "src/types/foo.test-d.tsx", "@ts-expect-error")).toEqual([]);
    for (const directive of ["@ts-ignore", "@ts-nocheck"]) {
      expect(banFindings(layout, "src/types/foo.test-d.ts", directive), directive).toEqual([expect.stringContaining(BAN)]);
    }
    expect(banFindings(layout, "src/types/foo.ts", "@ts-expect-error")).toEqual([expect.stringContaining(BAN)]);
    expect(banFindings(layout, "src/types/foo.test.ts", "@ts-expect-error")).toEqual([expect.stringContaining(BAN)]);
  });

  it("count towards no folder's size", () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`src/shared/lib/file-${i}.ts`, "export {};\n"]));
    const repo = makeRepo({ ...files, "src/shared/lib/x.test-d.ts": "export {};\n", "src/shared/lib/y.test-d.tsx": "export {};\n" });
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("stay out of the code index", () => {
    const repo = makeRepo({ "src/shared/lib/money.ts": "export const cents = 1;\n", "src/shared/lib/money.test-d.ts": "export const probe = 1;\n" });
    const index = backendModulesIndex(repo.root).join("\n");
    expect(index).toContain("`money.ts`: `cents`");
    expect(index).not.toContain("money.test-d.ts");
  });

  it("are entries to knip, so none is reported as an unused file", () => {
    const repo = templateRepo({
      "src/shared/lib/money.ts": "export const cents = (value: number): number => value * 100;\n",
      "src/shared/lib/money.test-d.ts":
        'import { expectTypeOf, test } from "vitest";\nimport { cents } from "./money";\n\ntest("cents", () => {\n  expectTypeOf(cents).returns.toEqualTypeOf<number>();\n});\n',
    });
    const result = spawnSync(path.join(repo.root, "node_modules/.bin/knip"), ["--config", "knip.config.ts", "--reporter", "json"], {
      cwd: repo.root,
      encoding: "utf8",
      timeout: 90_000,
    });
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("money.test-d.ts");
    expect(output).not.toContain('"name":"cents"');
  }, 120_000);
});
