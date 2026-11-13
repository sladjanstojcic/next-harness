import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../core/audit/audit.ts";
import { doneGate } from "../core/gates/done-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { checkGuards } from "../core/hooks/guards.ts";
import { unlock } from "../core/lock.ts";
import { SOURCE_PROBES } from "../shapes/next-probes.ts";
import { doubleCast, harnessRuleBlocks, HOOK_RULES, HOOKS_PLUGIN, workarounds } from "../presets/eslint-rules.ts";
import { eslintPreset, eslintPresetLines, expectedRules, probeToken } from "../tools/eslint-preset.ts";
import { harnessEslint } from "../presets/eslint.ts";
import { APP, CNA_ESLINT, initialised, presetFindings, ROOT_APP, run, withPresetLines } from "./preset-fixture.ts";

afterEach(() => vi.restoreAllMocks());

/** The harness's findings on create-next-app's own generated app code, generated without Tailwind and without shadcn. */
const CNA_APP_FINDINGS = ["app-file src/app/page.module.css", "thin-page src/app/page.tsx", "ui-stack package.json"];

const IMPORT = 'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";';
const WITH_PRESET = `${IMPORT}\nexport default [{ rules: { "no-console": "error" } }, ...harnessEslint({ root: import.meta.dirname, next: true })];\n`;

describe("the preset presence check", () => {
  it("probes each folder and extension, an area level, a test, a script, Next special files, route segments and fixed names", () => {
    expect(SOURCE_PROBES.map((probe) => probe.replaceAll("{name}", "N"))).toEqual([
      "src/app/N/N.ts",
      "src/app/N/N.tsx",
      "src/modules/N/N.ts",
      "src/modules/N/components/N.ts",
      "src/modules/N/components/N.tsx",
      "src/modules/N/server/N.ts",
      "src/modules/N/actions/N-action.ts",
      "src/modules/N/domain/N.ts",
      "src/modules/N/components/N/N.tsx",
      "src/modules/N/server/N/N.ts",
      "src/modules/N/domain/N/N.ts",
      "src/modules/N/domain/N.test.ts",
      "src/shared/components/N.tsx",
      "src/shared/lib/N.ts",
      "src/shared/hooks/N.ts",
      "src/backend/N.ts",
      "scripts/N.ts",
      "src/app/N/page.tsx",
      "src/app/N/layout.tsx",
      "src/app/N/route.ts",
      "src/app/N/N/page.tsx",
      "src/app/(N)/N/page.tsx",
      "src/app/[N]/page.tsx",
      "src/modules/N/index.ts",
      "src/modules/N/server.ts",
      "src/modules/N/schemas.ts",
      "src/modules/N/types.ts",
      "src/shared/lib/env.ts",
      "src/shared/lib/define-action.ts",
      "src/shared/lib/user-error.ts",
      "src/shared/lib/format.ts",
      "src/shared/lib/log.ts",
    ]);
    const names = Array.from({ length: 400 }, probeToken);
    expect(names.every((name) => /^[a-z0-9]+(?:-[a-z0-9]+)?$/.test(name) && name.length >= 3 && name.length <= 24)).toBe(true);
    expect(new Set(names.map((name) => name.length)).size).toBe(22);
    expect(names.some((name) => /\d/.test(name))).toBe(true);
    expect(names.some((name) => !/\d/.test(name))).toBe(true);
    expect(names.some((name) => name.includes("-"))).toBe(true);
    expect(names.some((name) => !name.includes("-"))).toBe(true);
    const first = eslintPreset("/repo", ROOT_APP).command.slice(3);
    const second = eslintPreset("/repo", ROOT_APP).command.slice(3);
    expect(first).toHaveLength(SOURCE_PROBES.length);
    expect(first.every((probe, index) => probe !== second[index] || SOURCE_PROBES.includes(probe))).toBe(true);
  });

  it("expects at each probe the preset's own settings there, block by block", () => {
    const settings = (probe: string) => expectedRules(probe);
    expect(settings("src/modules/a/domain/a.ts")["no-restricted-syntax"]).toEqual(["error", ...workarounds, doubleCast]);
    expect(settings("src/modules/a/server/a/a.ts")["no-restricted-syntax"]).toEqual(["error", ...workarounds]);
    expect(settings("src/modules/a/server/a.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBeUndefined();
    expect(settings("src/modules/a/domain/a.test.ts")["@typescript-eslint/no-non-null-assertion"]).toBe("off");
    expect(settings("scripts/a.ts")["no-console"]).toBe("off");
    expect(settings("src/shared/lib/a.ts")["no-console"]).toBe("error");
    expect(Object.keys(settings("src/app/a/a.tsx"))).toEqual([
      ...new Set(
        harnessRuleBlocks()
          .slice(0, 2)
          .flatMap(({ rules }) => Object.keys(rules)),
      ),
      ...Object.keys(HOOK_RULES),
    ]);
  });

  it("names each missing rule per probe path with the lines to add, and passes once create-next-app's config has them", async () => {
    const repo = initialised({ ...APP, "eslint.config.mjs": CNA_ESLINT });
    const missing = await presetFindings(repo.root);
    // Next's TypeScript config already sets no-explicit-any as an error; a rule the preset switches off cannot be missing.
    const rules = harnessRuleBlocks()
      .flatMap((block) => Object.keys(block.rules))
      .filter((rule) => rule !== "@typescript-eslint/no-explicit-any" && HOOK_RULES[rule] !== "off");
    expect(new Set(missing.map(({ message }) => message.split(" ")[0]))).toEqual(new Set([...rules, "linterOptions.noInlineConfig"]));
    const lines = `  ${IMPORT}\n  const harnessConfig = [...[eslintConfig].flat(), ...harnessEslint({ root: import.meta.dirname, base: false })];\n  export default harnessConfig;`;
    expect(missing[0]?.message).toContain(lines);
    expect(repo.report).toContain(lines.replaceAll("  ", "    "));
    repo.write("eslint.config.mjs", withPresetLines(CNA_ESLINT, repo.report));
    expect(await presetFindings(repo.root)).toEqual([]);
    // The kept config is linted too: Next's rules warn on an anonymous default export, and a warning fails the gate.
    const lint = run(repo.root, "eslint", ["src", "eslint.config.mjs", "--max-warnings", "0"]);
    expect(lint.status, lint.output).toBe(0);
  }, 120_000);

  it("prints base: false for a config that brings Next's or typescript-eslint's plugins, comments aside", () => {
    const spread = (config: string) => eslintPresetLines(ROOT_APP, config)[1];
    expect(spread(CNA_ESLINT)).toContain("base: false");
    expect(spread('import next from "@next/eslint-plugin-next";\nexport default [];\n')).toBe("...harnessEslint({ root: import.meta.dirname }),");
    expect(spread("// like eslint-config-next\n/* or typescript-eslint */\nexport default [];\n")).toContain("next: true");
    expect(spread('const url = "https://x";\nexport default [];\n')).toContain("next: true");
  });

  it("adds one plugin on top of a project's config, under a name of its own, so none is defined twice", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const blocks = harnessEslint({ root, base: false });
    expect(blocks.flatMap((block) => Object.keys(block.plugins ?? {}))).toEqual([HOOKS_PLUGIN]);
    expect(harnessEslint({ root, next: true }).some((block) => block.plugins?.import !== undefined)).toBe(true);
  });

  it("runs in Done only when a lint config input changed, and then blocks a weakened rule", async () => {
    const repo = initialised({ ...APP, "eslint.config.mjs": WITH_PRESET });
    const real = runner.runTool;
    const run = vi.spyOn(runner, "runTool").mockImplementation(async (root, step) => (step.name === "eslint-preset" ? real(root, step) : []));
    const presetRuns = () => run.mock.calls.filter(([, step]) => step.name === "eslint-preset").length;
    expect((await doneGate(repo.root, ["src/app/layout.tsx"])).passed).toBe(true);
    expect(presetRuns()).toBe(0);
    repo.write("eslint.config.mjs", WITH_PRESET.replace("next: true })]", 'next: true }), { rules: { "no-eval": "off" } }]'));
    const result = await doneGate(repo.root, ["src/app/layout.tsx", "eslint.config.mjs"]);
    expect(presetRuns()).toBe(1);
    expect(result.passed).toBe(false);
    const missing = result.findings.filter(({ rule }) => rule === "preset-missing");
    expect(new Set(missing.map(({ message }) => message.split(" ")[0]))).toEqual(new Set(["no-eval"]));
    expect(missing).toHaveLength(SOURCE_PROBES.length);
  }, 120_000);
});

describe("a project's own tool configs kept by init", () => {
  const OWN = {
    "eslint.config.mjs": CNA_ESLINT,
    ".prettierrc.json": "{}\n",
    "vitest.config.mts": "export default {};\n",
    "knip.json": "{}\n",
    "playwright.config.mjs": "export default {};\n",
  };

  it("pass the audit, are locked for agents, and become editable once the user unlocks", () => {
    const repo = initialised({ ...APP, ...OWN });
    expect(audit(repo.root).map(({ rule, file }) => `${rule} ${file}`)).toEqual(CNA_APP_FINDINGS);
    const edit = (file: string) =>
      checkGuards(
        parseEvent(
          "claude",
          {
            session_id: "s",
            cwd: repo.root,
            hook_event_name: "PreToolUse",
            tool_name: "Edit",
            tool_input: { file_path: file, old_string: "x", new_string: "y" },
          },
          repo.root,
        ),
        repo.root,
      );
    for (const file of Object.keys(OWN)) expect(edit(file)?.guard, file).toBe("harness-lock");
    expect(edit("other.config.mjs")?.guard).toBeDefined();
    expect(edit("other.config.mjs")?.guard).not.toBe("harness-lock");
    unlock(repo.root);
    for (const file of Object.keys(OWN)) expect(edit(file), file).toBeNull();
  });
});
