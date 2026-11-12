import { describe, expect, it } from "vitest";
import { runTool } from "../core/gates/run-tool.ts";
import { HOOK_RULES } from "../presets/eslint-rules.ts";
import { eslintPreset, expectedRules } from "../tools/eslint-preset.ts";
import { adoptedElectron, DESK_APP, ELECTRON_LEGACY_CONFIG, SCAFFOLD } from "./electron-repo.ts";
import { APP, CNA_ESLINT, initialised, presetFindings, run, withPresetLines } from "./preset-fixture.ts";

const ELECTRON = { path: "", shape: "electron-vite", next: false } as const;
const R = "src/renderer/src";
const OURS = ["harness-react-hooks/exhaustive-deps", "harness-react-hooks/rules-of-hooks"];
const THEIRS = ["react-hooks/exhaustive-deps", "react-hooks/rules-of-hooks"];

/** A hook called under a condition, and an effect that leaves `step` out of its dependencies. */
const COUNTER = [
  'import { useEffect, useState } from "react";',
  "",
  "export function Counter({ step }: { step: number }) {",
  "  const [count, setCount] = useState(0);",
  "  if (step > 0) {",
  "    useEffect(() => {",
  "      setCount(step);",
  "    });",
  "  }",
  "  useEffect(() => {",
  "    setCount(step);",
  "  }, []);",
  "  return <p>{count}</p>;",
  "}",
  "",
].join("\n");
/** The same mistake in the main process, where a function named use… is no React hook. */
const MAIN = "const useOther = (): number => 1;\n\nexport function useThing(flag: boolean): number {\n  if (flag) return useOther();\n  return 0;\n}\n";

/** A Playwright fixture calls a parameter named `use`, which is no React hook. */
const FIXTURE = [
  'import { test as base } from "@playwright/test";',
  "",
  "export const test = base.extend<{ greeting: string }>({",
  "  greeting: async ({ page }, use) => {",
  '    await page.goto("/");',
  '    await use("hello");',
  "  },",
  "});",
  "",
].join("\n");

interface Message {
  ruleId: string | null;
  severity: number;
}

/** Each hook finding ESLint reports on a file, as `rule:severity`, sorted and without repeats. */
function hookFindings(root: string, file: string): string[] {
  const { output } = run(root, "eslint", ["-f", "json", file]);
  const results = JSON.parse(output) as { messages: Message[] }[];
  const hooks = results.flatMap(({ messages }) => messages).filter(({ ruleId }) => [...OURS, ...THEIRS].includes(ruleId ?? ""));
  return [...new Set(hooks.map(({ ruleId, severity }) => `${ruleId ?? ""}:${String(severity)}`))].sort();
}

const ERRORS = OURS.map((rule) => `${rule}:2`);
const aboutHooks = (findings: { message: string }[]): string[] =>
  [...new Set(findings.map(({ message }) => message.split(" ")[0] ?? "").filter((rule) => rule.includes("react-hooks")))].sort();

describe("the React hook rules of the preset", () => {
  it("are errors under the harness's own plugin name, with the project's two rules of the same kind switched off", () => {
    expect(HOOK_RULES).toEqual({ [OURS[0] ?? ""]: "error", [OURS[1] ?? ""]: "error", [THEIRS[0] ?? ""]: "off", [THEIRS[1] ?? ""]: "off" });
  });

  it("apply to .ts and .tsx of an app in both layouts and of a package, and in an Electron app to the renderer only", () => {
    const on = (probe: string, layout?: Parameters<typeof expectedRules>[1]) => OURS.map((rule) => expectedRules(probe, layout)[rule]);
    expect(on("src/modules/a/components/a.tsx")).toEqual(["error", "error"]);
    expect(on("src/shared/hooks/use-a.ts")).toEqual(["error", "error"]);
    expect(on("modules/a/components/a.tsx", "app-root")).toEqual(["error", "error"]);
    expect(on("src/hooks/use-a.ts", "package")).toEqual(["error", "error"]);
    expect(on(`${R}/modules/a/hooks/use-a.ts`, "electron")).toEqual(["error", "error"]);
    expect(on(`${R}/app.tsx`, "electron")).toEqual(["error", "error"]);
    for (const outside of ["src/main/index.ts", "src/preload/index.ts", "src/shared/notes.ts", "electron.vite.config.ts"])
      expect(on(outside, "electron"), outside).toEqual([undefined, undefined]);
  });
});

describe("the hook rules beside a project's own react-hooks plugin", () => {
  it("report once, as errors, in create-next-app's config, which brings the plugin through eslint-config-next", async () => {
    const file = "src/modules/orders/components/counter.tsx";
    const repo = initialised({ ...APP, "eslint.config.mjs": CNA_ESLINT, [file]: COUNTER });
    const adopted = withPresetLines(CNA_ESLINT, repo.report);
    const call = "...harnessEslint({ root: import.meta.dirname, base: false })";
    expect(adopted).toContain(`${call}];`);
    repo.write("eslint.config.mjs", adopted);
    expect(hookFindings(repo.root, file)).toEqual(ERRORS);
    expect(await presetFindings(repo.root)).toEqual([]);

    repo.write("eslint.config.mjs", adopted.replace(`${call}]`, `${call}, { rules: { "harness-react-hooks/exhaustive-deps": "warn" } }]`));
    expect(aboutHooks(await presetFindings(repo.root))).toEqual(["harness-react-hooks/exhaustive-deps"]);
  }, 240_000);

  it("report once in the thin config init writes, where the preset itself adds eslint-config-next", () => {
    const file = "src/modules/orders/components/counter.tsx";
    const repo = initialised({ ...APP, [file]: COUNTER, "e2e/fixtures.ts": FIXTURE, "scripts/use-thing.ts": MAIN });
    expect(hookFindings(repo.root, file)).toEqual(ERRORS);
    for (const beside of ["e2e/fixtures.ts", "scripts/use-thing.ts"])
      expect(hookFindings(repo.root, beside).filter((finding) => finding.startsWith("harness-"))).toEqual([]);
  }, 120_000);

  it.each([
    ["an Electron config that registers the plugin for the renderer and takes the preset without its base", DESK_APP, undefined],
    ["the electron-vite scaffold's config, which registers the plugin for every file", SCAFFOLD, ELECTRON_LEGACY_CONFIG],
  ])(
    "report once in %s, and not outside the renderer",
    async (_name, files, config) => {
      const component = `${R}/modules/notes/components/counter.tsx`;
      const repo = adoptedElectron({ ...files, [component]: COUNTER, "src/main/notes/use-thing.ts": MAIN }, config);
      expect(hookFindings(repo.root, component)).toEqual(ERRORS);
      expect(hookFindings(repo.root, "src/main/notes/use-thing.ts").filter((finding) => finding.startsWith("harness-"))).toEqual([]);
      expect(aboutHooks(await runTool(repo.root, eslintPreset(repo.root, ELECTRON)))).toEqual([]);
    },
    240_000,
  );
});
