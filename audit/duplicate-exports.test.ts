import { describe, expect, it } from "vitest";
import { makeRepo } from "../testing/temp-repo.ts";
import { audit, auditChanged } from "./audit.ts";
import { findDuplicateExports } from "./duplicate-exports.ts";

function largeFunction(name: string, parameter: string): string {
  return `export function ${name}(${parameter}: number): number {
    const doubled = ${parameter} * 2;
    const increased = doubled + 1;
    if (increased > 10) return increased - 3;
    return increased + doubled + ${parameter} + 1;
  }`;
}

const original = "src/modules/a/components/calculate-a.ts";
const copy = "src/modules/b/components/calculate-b.ts";

describe("findDuplicateExports", () => {
  it("finds renamed 45-node functions and identifies the original", () => {
    const repo = makeRepo({ [original]: largeFunction("calculate", "value"), [copy]: largeFunction("compute", "input") });
    const findings = findDuplicateExports(repo.root, [original, copy]);
    expect(findings).toContainEqual({ rule: "duplicate-export", file: copy, line: 1, message: expect.stringContaining(`${original}#calculate`) as unknown });
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toContain("src/shared/");
    expect(audit(repo.root)).toEqual(findings);
  });

  it.each([original, copy])("finds a selected copy against the full inventory: %s", (selected) => {
    const repo = makeRepo({ [original]: largeFunction("calculate", "value"), [copy]: largeFunction("compute", "input") });
    expect(findDuplicateExports(repo.root, [selected])).toEqual([expect.objectContaining({ rule: "duplicate-export", file: selected })]);
    expect(auditChanged(repo.root, [selected])).toEqual([]);
  });

  it("does not flag 10-node idioms", () => {
    const repo = makeRepo({ [original]: "export function a(x: number): number { return x; }", [copy]: "export function b(y: number): number { return y; }" });
    expect(findDuplicateExports(repo.root, [original, copy])).toEqual([]);
  });

  it("preserves literal values in the shape", () => {
    const repo = makeRepo({
      [original]: largeFunction("a", "value"),
      [copy]: largeFunction("b", "input").replace("10", "11"),
    });
    expect(findDuplicateExports(repo.root, [original, copy])).toEqual([]);
  });

  it("covers exported arrow functions with renamed locals", () => {
    const first = largeFunction("a", "value").replace("function a(value: number): number", "const a = (value: number): number =>");
    const second = first.replace("const a =", "const b =").replaceAll("doubled", "twice");
    const repo = makeRepo({ [original]: first, [copy]: second });
    expect(findDuplicateExports(repo.root, [original, copy])).toHaveLength(2);
  });

  it("preserves external names in large functions", () => {
    const repo = makeRepo({
      [original]: largeFunction("a", "value").replace("doubled + 1", "externalA(value)"),
      [copy]: largeFunction("b", "input").replace("doubled + 1", "externalB(input)"),
    });
    expect(findDuplicateExports(repo.root, [original, copy])).toEqual([]);
  });

  it("skips tests, fixtures and vendored code", () => {
    const excluded = ["src/shared/ui/button.tsx", "src/shared/lib/utils.ts", "tooling/harness/copy.test.ts", "src/modules/a/components/test-data.ts"];
    const repo = makeRepo(Object.fromEntries([original, ...excluded].map((file) => [file, largeFunction("calculate", "value")])));
    expect(findDuplicateExports(repo.root, [original, ...excluded])).toEqual([]);
  });

  it("does not compare unexported implementations", () => {
    const repo = makeRepo({ [original]: largeFunction("a", "value"), [copy]: largeFunction("b", "input").replace("export ", "") });
    expect(findDuplicateExports(repo.root, [original, copy])).toEqual([]);
  });
});
