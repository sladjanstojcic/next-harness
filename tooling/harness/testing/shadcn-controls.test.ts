import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { harnessRuleBlocks, RAW_CONTROLS, type PresetLayout, type RuleBlock } from "../presets/eslint-rules.ts";
import { expectedRules } from "../tools/eslint-preset.ts";
import { presetFindings } from "./preset-fixture.ts";
import { templateRepo } from "./template-repo.ts";

const SYNTAX = "no-restricted-syntax";
const selectorsOf = (block: RuleBlock | undefined): string[] => {
  const setting = block?.rules[SYNTAX];
  const options: unknown[] = Array.isArray(setting) ? setting.slice(1) : [];
  return options.map((option) => (typeof option === "object" && option !== null && "selector" in option ? String(option.selector) : ""));
};
const controls = (selectors: string[]): string[] => selectors.filter((selector) => selector.startsWith("JSXOpeningElement"));
const syntaxBlocks = (layout: PresetLayout, shadcn: boolean): RuleBlock[] =>
  harnessRuleBlocks(layout, undefined, shadcn).filter((block) => block.rules[SYNTAX] !== undefined);

describe("the rule against hand-made controls", () => {
  it("names the seven raw elements", () => {
    expect(RAW_CONTROLS).toEqual(["button", "input", "select", "textarea", "label", "table", "dialog"]);
  });

  it("changes nothing in a workspace without components.json", () => {
    for (const layout of ["app", "app-root", "package", "electron"] as const) {
      expect(harnessRuleBlocks(layout, undefined, false)).toEqual(harnessRuleBlocks(layout));
      expect(JSON.stringify(harnessRuleBlocks(layout))).not.toContain("JSXOpeningElement");
    }
  });

  it.each([
    ["app", "src/shared/ui/"],
    ["app-root", "shared/ui/"],
    ["electron", "src/renderer/src/shared/ui/"],
  ] as const)("adds one selector per element to every no-restricted-syntax block of the %s layout and keeps the others", (layout, ui) => {
    const without = syntaxBlocks(layout, false);
    const withControls = syntaxBlocks(layout, true);
    expect(withControls).toHaveLength(3);
    withControls.forEach((block, index) => {
      const selectors = selectorsOf(block);
      expect(selectors.slice(0, -RAW_CONTROLS.length)).toEqual(selectorsOf(without[index]));
      expect(controls(selectors)).toEqual(RAW_CONTROLS.map((element) => `JSXOpeningElement[name.type='JSXIdentifier'][name.name='${element}']`));
    });
    const message = JSON.stringify(withControls[0]?.rules[SYNTAX]);
    expect(message).toContain(`Use the shadcn component from ${ui} instead of a raw <button>`);
    expect(message).toContain("`pnpm dlx shadcn add button`");
    expect(message).toContain("say so in the handoff before building it by hand");
  });

  it("has no such rule in a package, which holds no shared/ui/", () => {
    expect(harnessRuleBlocks("package", undefined, true)).toEqual(harnessRuleBlocks("package"));
  });

  it("is part of what the presence check expects at a probe, tests included", () => {
    for (const probe of ["src/modules/a/components/a.tsx", "src/modules/a/server/a.ts", "src/modules/a/domain/a.test.ts", "scripts/a.ts"]) {
      const expected = expectedRules(probe, "app", undefined, true)[SYNTAX];
      expect(controls(selectorsOf({ files: [], rules: expected === undefined ? {} : { [SYNTAX]: expected } })), probe).toHaveLength(RAW_CONTROLS.length);
      expect(JSON.stringify(expectedRules(probe)[SYNTAX]), probe).not.toContain("JSXOpeningElement");
    }
  });
});

const VIEW = [
  "export function View() {",
  "  return (",
  "    <form>",
  '      <label htmlFor="name">Name</label>',
  '      <input id="name" />',
  "      <select />",
  "      <textarea />",
  "      <table />",
  "      <dialog />",
  '      <button type="submit">Save</button>',
  "    </form>",
  "  );",
  "}",
  "",
].join("\n");
const COMPOSED = 'import { Button } from "@/shared/ui/button";\n\nexport function Save() {\n  return <Button>Save</Button>;\n}\n';
const PRIMITIVE = 'export function Button(props: React.ComponentProps<"button">) {\n  return <button {...props} />;\n}\n';
const FILES = {
  "src/modules/orders/components/view.tsx": VIEW,
  "src/modules/orders/components/view.test.tsx": VIEW,
  "src/modules/orders/components/save.tsx": COMPOSED,
  "src/shared/ui/button.tsx": PRIMITIVE,
};

function lint(root: string): { status: number | null; output: string } {
  const result = spawnSync(path.join(root, "node_modules/.bin/eslint"), ["src", "--max-warnings", "0"], { cwd: root, encoding: "utf8", timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("the real ESLint run", () => {
  it("reports each raw control outside shared/ui/ once the workspace has components.json", () => {
    const repo = templateRepo({ ...FILES, "components.json": "{}\n" });
    const result = lint(repo.root);
    expect(result.status, result.output).toBe(1);
    for (const element of RAW_CONTROLS) expect(result.output).toContain(`instead of a raw <${element}>`);
    expect(result.output.match(/instead of a raw </g)).toHaveLength(2 * RAW_CONTROLS.length);
    expect(result.output).toContain("view.tsx");
    expect(result.output).toContain("view.test.tsx");
    expect(result.output).not.toContain("save.tsx");
    expect(result.output).not.toContain("button.tsx");
  }, 120_000);

  it("reports nothing without components.json", () => {
    const result = lint(templateRepo(FILES).root);
    expect(result.status, result.output).toBe(0);
  }, 120_000);

  it("is held by the presence check: a config that drops the selectors is reported", async () => {
    const repo = templateRepo({ "components.json": "{}\n" });
    expect(await presetFindings(repo.root)).toEqual([]);
    const weakened = repo
      .read("eslint.config.ts")
      .replace(
        'export default harnessEslint({ root: import.meta.dirname, next: true, harness: "lint" });',
        'export default [...harnessEslint({ root: import.meta.dirname, next: true, harness: "lint" }), { files: ["**/*.tsx"], rules: { "no-restricted-syntax": ["error", { selector: "ExportAllDeclaration", message: "x" }, { selector: "TSAsExpression > TSNeverKeyword.typeAnnotation", message: "x" }, { selector: "ImportExpression[source.type!=\'Literal\']", message: "x" }, { selector: "CallExpression[callee.name=\'require\']", message: "x" }, { selector: "TSAsExpression > TSAsExpression", message: "x" }] } }];',
      );
    expect(weakened).toContain("ExportAllDeclaration");
    repo.write("eslint.config.ts", weakened);
    const findings = await presetFindings(repo.root);
    expect(findings.length).toBeGreaterThan(0);
    expect(new Set(findings.map(({ message }) => message.split(" ")[0]))).toEqual(new Set([SYNTAX]));
    expect(findings.every(({ message }) => /for \S+\.tsx /.test(message))).toBe(true);
  }, 120_000);
});
