import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ciGate } from "../core/gates/ci-gate.ts";
import { doneGate } from "../core/gates/done-gate.ts";
import { fastGate } from "../core/gates/fast-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { harnessRuleBlocks } from "../presets/eslint-rules.ts";
import { oxc, OXLINT_OWNED } from "../tools/oxc.ts";
import { MAKERKIT_KIT_ROUTE, MAKERKIT_ROUTE, makerkitConfig, makerkitRepo } from "./makerkit-repo.ts";

afterEach(() => vi.restoreAllMocks());

const PLAN_RULES = ["typescript/no-explicit-any", "typescript/ban-ts-comment", "typescript/no-non-null-assertion", "no-console", "no-eval", "max-lines"];

const oxlintConfig = z.object({
  rules: z.record(z.string(), z.unknown()),
  overrides: z.array(z.object({ files: z.array(z.string()), rules: z.record(z.string(), z.unknown()) })),
});

const preset = () => oxlintConfig.parse(JSON.parse(fs.readFileSync(OXLINT_OWNED, "utf8")));

const eslintName = (rule: string): string => rule.replace(/^typescript\//, "@typescript-eslint/");

describe("the owned oxlint preset", () => {
  it("sets the plan's rules and nothing else", () => {
    expect(Object.keys(preset().rules).sort()).toEqual([...PLAN_RULES].sort());
  });

  it("takes every setting from the ESLint preset's table, so both projects get the same rules", () => {
    const [all, , tests] = harnessRuleBlocks();
    for (const [rule, setting] of Object.entries(preset().rules)) expect(setting, rule).toEqual(all?.rules[eslintName(rule)]);
    const [override] = preset().overrides;
    expect(override?.files).toEqual(["**/*.test.ts", "**/*.test.tsx"]);
    const offInTests = Object.keys(preset().rules).filter((rule) => tests?.rules[eslintName(rule)] === "off");
    expect(override?.rules).toEqual(Object.fromEntries(offInTests.map((rule) => [rule, "off"])));
    expect(offInTests).toEqual(["typescript/no-non-null-assertion"]);
  });

  it("lints with the harness's config, ignoring ignore files, as its own step", () => {
    expect(OXLINT_OWNED).toBe(path.join(import.meta.dirname, "../presets/oxlint-owned.json"));
    const step = oxc.lint.owned?.("/w", ["a.ts", "b.test.tsx"]);
    expect(step?.name).toBe("oxlint-owned");
    expect(step?.command).toEqual(["/w/node_modules/.bin/oxlint", "-c", OXLINT_OWNED, "-f", "json", "--no-error-on-unmatched-pattern", "a.ts", "b.test.tsx"]);
    const output = JSON.stringify({
      diagnostics: [{ message: "Unexpected any.", code: "typescript-eslint(no-explicit-any)", filename: "a.ts", labels: [{ span: { line: 2 } }] }],
    });
    expect(step?.findings(output, 1)).toEqual([{ rule: "no-explicit-any", file: "a.ts", line: 2, message: "Unexpected any." }]);
  });

  it("block 9aec2d: states the line limit, which oxlint 1.87.0 leaves in help", () => {
    const output = `{ "diagnostics": [{"message": "File has too many lines (260).","code": "eslint(max-lines)","severity": "error","help": "Maximum allowed is 250.","filename": "long.ts","labels": [{"span": {"offset": 6279,"length": 0,"line": 260,"column": 25}}]}] }`;
    expect(oxc.lint.owned?.("/w", ["long.ts"]).findings(output, 1)).toEqual([
      { rule: "max-lines", file: "long.ts", line: 260, message: "File has too many lines (260). (maximum 250 lines, blank lines and comments count)" },
    ]);
    expect(oxc.lint.all("/w").findings(output, 1)[0]?.message).toBe("File has too many lines (260).");
  });
});

const OWNED_FILE = "packages/features/journal/src/server/services/journal.service.ts";
const OWNED_PAGE = `${MAKERKIT_ROUTE}/page.tsx`;
const KIT_FILE = "packages/features/accounts/src/server/api.ts";
const LEGACY_FILE = "packages/features/journal/src/server/services/old.service.ts";

function lintRepo() {
  const owned = [`${MAKERKIT_ROUTE}/`, "packages/features/journal/", "apps/web/supabase/"];
  const repo = makerkitRepo({
    "harness.config.ts": makerkitConfig(owned).replace("  owned:", '  legacy: "tooling/harness-legacy.json",\n  owned:'),
    "tooling/harness-legacy.json": `${JSON.stringify({ version: 1, files: [LEGACY_FILE] })}\n`,
    "node_modules/.bin/oxlint": "",
    "node_modules/.bin/oxfmt": "",
    "node_modules/.bin/tsc": "",
    "node_modules/.bin/vitest": "",
    "apps/web/node_modules/.bin/next": "",
    [OWNED_FILE]: 'import "server-only";\nexport const a = 1;\n',
    [OWNED_PAGE]: "export default function Page() {\n  return null;\n}\n",
    [LEGACY_FILE]: 'import "server-only";\nexport const b = 1;\n',
    "packages/ui/src/shadcn/card.tsx": "export const Card = () => null;\n",
  });
  const real = fs.realpathSync(repo.root);
  const steps: { name: string; cwd: string; files: string[] }[] = [];
  vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
    const cwd = path.relative(real, fs.realpathSync(step.cwd ?? real)) || ".";
    if (step.name.startsWith("oxlint")) steps.push({ name: step.name, cwd, files: step.command.filter((arg) => /\.tsx?$/.test(arg)) });
    return [];
  });
  return { repo, steps };
}

describe("the gates run the owned preset on owned and legacy files only", () => {
  it("fast: owned and legacy files get both passes, kit and vendored files only the project's", async () => {
    const { repo, steps } = lintRepo();
    const files = [OWNED_FILE, OWNED_PAGE, KIT_FILE, LEGACY_FILE, "packages/ui/src/shadcn/card.tsx", `${MAKERKIT_KIT_ROUTE}/page.tsx`];
    await fastGate(repo.root, files);
    expect(steps).toEqual([
      { name: "oxlint", cwd: "apps/web", files: ["app/[locale]/home/[account]/billing/page.tsx", "app/[locale]/home/[account]/journal/page.tsx"] },
      { name: "oxlint-owned", cwd: "apps/web", files: ["app/[locale]/home/[account]/journal/page.tsx"] },
      { name: "oxlint", cwd: "packages/features/accounts", files: ["src/server/api.ts"] },
      { name: "oxlint", cwd: "packages/features/journal", files: ["src/server/services/journal.service.ts", "src/server/services/old.service.ts"] },
      { name: "oxlint-owned", cwd: "packages/features/journal", files: ["src/server/services/journal.service.ts", "src/server/services/old.service.ts"] },
    ]);
  });

  it("fast: a kit-only change runs no owned pass", async () => {
    const { repo, steps } = lintRepo();
    await fastGate(repo.root, [KIT_FILE]);
    expect(steps.map((step) => step.name)).toEqual(["oxlint"]);
  });

  it("CI: the owned pass lists every owned and legacy source file of each workspace", async () => {
    const { repo, steps } = lintRepo();
    await ciGate(repo.root);
    expect(steps.filter((step) => step.name === "oxlint-owned")).toEqual([
      { name: "oxlint-owned", cwd: "apps/web", files: ["app/[locale]/home/[account]/journal/page.tsx"] },
      { name: "oxlint-owned", cwd: "packages/features/journal", files: ["src/server/services/journal.service.ts", "src/server/services/old.service.ts"] },
    ]);
    expect(steps.filter((step) => step.name === "oxlint").map((step) => step.cwd)).toEqual([
      "apps/web",
      "packages/features/accounts",
      "packages/features/journal",
    ]);
  });

  it("Done: an owned-rule finding on a changed legacy file blocks, as a lint finding does in a next-modules project", async () => {
    const { repo } = lintRepo();
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) =>
      step.name === "oxlint-owned"
        ? step.findings(
            JSON.stringify({
              diagnostics: [{ message: "Unexpected any.", code: "typescript-eslint(no-explicit-any)", filename: "src/server/services/old.service.ts" }],
            }),
            1,
          )
        : [],
    );
    repo.write(LEGACY_FILE, 'import "server-only";\nexport const b: any = 1;\n');
    const result = await doneGate(repo.root, [LEGACY_FILE]);
    expect(result.findings).toEqual([{ rule: "no-explicit-any", file: LEGACY_FILE, message: "Unexpected any." }]);
  });
});
