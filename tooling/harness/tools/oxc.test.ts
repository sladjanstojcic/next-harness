import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../testing/temp-repo.ts";
import { oxc } from "./oxc.ts";
import { placeStep } from "./tool-set.ts";

const DIR = "/repo/apps/web";
const binOf = (tool: string): string => path.join(DIR, "node_modules/.bin", tool);

// Captured from oxlint 1.87.0 (`oxlint -f json`), trimmed to the fields the parser reads plus a few it ignores.
const FINDINGS = `{ "diagnostics": [{"message": "Variable 'unused' is declared but never used. Unused variables should start with a '_'.","code": "eslint(no-unused-vars)","severity": "error","url": "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html","help": "Consider removing this declaration.","filename": "sub/bad.ts","labels": [{"label": "'unused' is declared here","span": {"offset": 6,"length": 6,"line": 1,"column": 7}}]},
{"message": "Unexpected \`any\`. Specify a different type.","code": "typescript(no-explicit-any)","severity": "error","filename": "/repo/apps/web/sub/bad.ts","labels": [{"span": {"offset": 39,"length": 3,"line": 2,"column": 22}}]},
{"message": "\`debugger\` statement is not allowed","code": "eslint(no-debugger)","severity": "warning","filename": "sub/bad.ts","labels": [{"span": {"offset": 48,"length": 9,"line": 3,"column": 3}}]}],
              "number_of_files": 1,
              "number_of_rules": 97,
              "threads_count": 10,
              "start_time": 0.025796292
            }`;
const CLEAN = `{ "diagnostics": [],
              "number_of_files": 1,
              "number_of_rules": 96,
              "threads_count": 10,
              "start_time": 0.003896083
            }`;

describe("oxlint findings", () => {
  it("names each rule without its plugin, maps paths to the workspace and keeps warnings", () => {
    expect(oxc.lint.files(DIR, ["sub/bad.ts"], false).findings(FINDINGS, 1)).toEqual([
      {
        rule: "no-unused-vars",
        file: "sub/bad.ts",
        line: 1,
        message: "Variable 'unused' is declared but never used. Unused variables should start with a '_'.",
      },
      { rule: "no-explicit-any", file: "sub/bad.ts", line: 2, message: "Unexpected `any`. Specify a different type." },
      { rule: "no-debugger", file: "sub/bad.ts", line: 3, message: "`debugger` statement is not allowed" },
    ]);
  });

  it("names a parse error without a code oxlint", () => {
    const syntax = `{ "diagnostics": [{"message": "Unexpected token","severity": "error","filename": "syntax.ts","labels": [{"span": {"offset": 22,"length": 1,"line": 1,"column": 23}}]}],
              "number_of_files": 1,
              "number_of_rules": 96,
              "threads_count": 10,
              "start_time": 0.016822167
            }`;
    expect(oxc.lint.files(DIR, ["syntax.ts"], false).findings(syntax, 1)).toEqual([
      { rule: "oxlint", file: "syntax.ts", line: 1, message: "Unexpected token" },
    ]);
  });

  it("reports nothing for a clean run", () => {
    expect(oxc.lint.all(DIR).findings(CLEAN, 0)).toEqual([]);
  });

  it("throws on output that is not JSON, which the runner reports as oxlint-failed", () => {
    expect(() => oxc.lint.all(DIR).findings("Failed to parse configuration file", 1)).toThrow();
    expect(oxc.lint.all(DIR).name).toBe("oxlint");
  });
});

describe("oxfmt findings", () => {
  const checkStep = () => oxc.format.check(makeRepo().root);

  it("reports every listed path, the last one without a newline", () => {
    const step = checkStep();
    expect(step.findings("a.ts\nsub/b.tsx", 1)).toEqual([
      { rule: "oxfmt", file: "a.ts", message: "Run oxfmt on this file." },
      { rule: "oxfmt", file: "sub/b.tsx", message: "Run oxfmt on this file." },
    ]);
    expect(step.findings("a.ts\n", 1)).toHaveLength(1);
  });

  it("reports nothing when no path is listed, so a failing exit becomes oxfmt-failed", () => {
    const step = checkStep();
    expect(step.name).toBe("oxfmt");
    expect(step.findings("", 1)).toEqual([]);
  });
});

describe("oxc steps", () => {
  it("formats and lints the given files", () => {
    expect(oxc.format.write(DIR, ["a.ts"]).command).toEqual([binOf("oxfmt"), "--no-error-on-unmatched-pattern", "a.ts"]);
    expect(oxc.lint.files(DIR, ["a.ts", "b.tsx"], true).command).toEqual([binOf("oxlint"), "-f", "json", "--no-error-on-unmatched-pattern", "a.ts", "b.tsx"]);
    expect(oxc.lint.all(DIR).command).toEqual([binOf("oxlint"), "-f", "json", "--no-error-on-unmatched-pattern"]);
  });

  it("checks the format of the workspace's source files only", () => {
    const repo = makeRepo({ "apps/web/a.ts": "", "apps/web/b.mjs": "", "apps/web/c.md": "", "apps/web/d/e.tsx": "", "other.ts": "" });
    const dir = path.join(repo.root, "apps/web");
    expect(oxc.format.check(dir).command).toEqual([
      path.join(dir, "node_modules/.bin/oxfmt"),
      "--list-different",
      "--no-error-on-unmatched-pattern",
      "a.ts",
      "b.mjs",
      "d/e.tsx",
    ]);
  });

  it("generates Next types first, then runs plain tsc with parsed findings", () => {
    const steps = oxc.typecheck.incremental(DIR, true);
    expect(steps.map((step) => step.command)).toEqual([
      [binOf("next"), "typegen"],
      [binOf("tsc"), "--noEmit", "--pretty", "false"],
    ]);
    expect(oxc.typecheck.all(DIR, false).map((step) => step.command)).toEqual([[binOf("tsc"), "--noEmit", "--pretty", "false"]]);
    expect(steps[1]?.findings("app/page.tsx(3,5): error TS2322: Type 'string' is not assignable to type 'number'.", 2)).toEqual([
      { rule: "TS2322", file: "app/page.tsx", line: 3, message: "Type 'string' is not assignable to type 'number'." },
    ]);
  });

  it("runs related tests and the whole suite with vitest", () => {
    expect(oxc.test.related(DIR, ["a.ts"]).command).toEqual([binOf("vitest"), "related", "--run", "--passWithNoTests", "a.ts"]);
    expect(oxc.test.all(DIR).command).toEqual([binOf("vitest"), "run"]);
  });

  it("finds a binary installed at the git root for a workspace folder and maps findings back", () => {
    const repo = makeRepo({ "node_modules/.bin/oxlint": "", "apps/web/a.ts": "" });
    const placed = placeStep(repo.root, "apps/web", oxc.lint.all(path.join(repo.root, "apps/web")));
    if ("finding" in placed) throw new Error(placed.finding.message);
    expect(placed.command[0]).toBe(path.join(repo.root, "node_modules/.bin/oxlint"));
    expect(placed.findings(FINDINGS, 1)[0]?.file).toBe("apps/web/sub/bad.ts");
  });
});
