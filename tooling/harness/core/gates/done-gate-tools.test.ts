import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { templateRepo } from "../../testing/template-repo.ts";
import { doneGate } from "./done-gate.ts";
import * as runner from "./run-tool.ts";

afterEach(() => vi.restoreAllMocks());

describe("Done tool results", () => {
  it("describes out-of-scope findings without claiming they predate this turn", async () => {
    const repo = makeRepo({}, { agents: true });
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) =>
      step.name === "knip" ? [{ rule: "knip-exports", file: "src/shared/lib/unused.ts", message: "Unused export" }] : [],
    );
    const result = await doneGate(repo.root, ["README.md"]);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("Outside this turn's files (not blocking)");
    expect(result.report).not.toContain("Pre-existing");
  });

  it("runs related tests and blocks a test failure with a tool-failed finding", async () => {
    const file = "src/shared/lib/value.ts";
    const repo = templateRepo({
      [file]: "export const value = 1;\n",
      "src/shared/lib/value.test.ts":
        "import { expect, it } from 'vitest';\nimport { value } from './value';\nit('value', () => { expect(value).toBe(2); });\n",
    });
    const result = await doneGate(repo.root, [file]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "vitest-failed" }));
    expect(result.report).toContain("expected 1 to be 2");
    expect(result.report).not.toMatch(/\b\d+(?:\.\d+)?(?:ms|s)\b/);
  }, 120_000);

  it("keeps repeated failures identical despite tool timings and clock output", async () => {
    const repo = makeRepo();
    let output = "Start at 10:11:12\nDuration 1.23s\nfailed";
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) =>
      step.name === "vitest" ? [{ rule: "vitest-failed", file: "", message: output }] : [],
    );
    const first = await doneGate(repo.root, ["README.md"]);
    output = "Start at 10:12:13\nDuration 2.34s\nfailed";
    const second = await doneGate(repo.root, ["README.md"]);
    expect(second.report).toBe(first.report);
  });

  it("always blocks tool failures, including malformed depcruise output", async () => {
    const repo = makeRepo({ "src/shared/lib/x.ts": "export const value = 1;\n" });
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
      if (step.name === "depcruise") {
        expect(() => step.findings("not json", 0)).toThrow();
        return [{ rule: "depcruise-failed", file: "unchanged.ts", message: "bad output" }];
      }
      return [];
    });
    const result = await doneGate(repo.root, ["src/shared/lib/x.ts"]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual({ rule: "depcruise-failed", file: "unchanged.ts", message: "bad output" });
  });

  it.each([
    ["node:fs", true, false, false, false],
    ["missing", false, true, false, true],
    ["undeclared", false, false, true, true],
    ["installed/subpath", false, true, true, false],
    ["@scope/installed/subpath", false, true, true, false],
  ] as const)("scopes unresolved %s with core/declaration/installation evidence", async (specifier, core, declared, installed, blocks) => {
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
    const repo = makeRepo(
      { "package.json": JSON.stringify({ dependencies: declared ? { [name]: "1.0.0" } : {} }), ".gitignore": "node_modules/\n" },
      { agents: true, stack: true },
    );
    if (installed) repo.write(`node_modules/${name}/package.json`, JSON.stringify({ name }));
    const importer = "src/shared/lib/importer.ts";
    const consumer = "src/shared/lib/consumer.ts";
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
      if (step.name === "tsc")
        return [
          { rule: "TS2307", file: importer, message: "Missing module" },
          { rule: "TS2339", file: consumer, message: "Missing property" },
        ];
      if (step.name === "depcruise")
        return step.findings(
          JSON.stringify({
            modules: [
              { source: importer, dependencies: [{ resolved: specifier, couldNotResolve: true, coreModule: core }] },
              { source: consumer, dependencies: [{ resolved: importer, couldNotResolve: false, coreModule: false }] },
            ],
            summary: { violations: [] },
          }),
          0,
        );
      return [];
    });
    const result = await doneGate(repo.root, ["README.md"]);
    expect(result.passed).toBe(!blocks);
    expect((blocks ? result.findings : result.preExisting).map((finding) => finding.file)).toEqual([importer, consumer]);
  });
});
