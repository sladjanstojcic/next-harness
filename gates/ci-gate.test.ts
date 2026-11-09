import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auditor from "../audit/audit.ts";
import { makeRepo } from "../testing/temp-repo.ts";
import { ciGate } from "./ci-gate.ts";
import * as runner from "./run-tool.ts";

afterEach(() => vi.restoreAllMocks());

describe("CI gate", () => {
  it("runs all checks in order with full typed lint even after middle failures", async () => {
    const repo = makeRepo({ "src/utils/date.ts": "export const today = 1;" });
    const calls: string[] = [];
    const audit = vi.spyOn(auditor, "audit");
    audit.mockImplementation((root) => {
      calls.push("audit");
      return [{ rule: "src-shape", file: path.relative(root, path.join(root, "src/utils/date.ts")), message: "Put utilities in src/shared/lib/." }];
    });
    const run = vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
      calls.push([path.basename(step.command[0] ?? ""), ...step.command.slice(1)].join(" "));
      return step.name === "knip" ? [{ rule: "knip-failed", file: "", message: "Unused exports" }] : [];
    });
    const result = await ciGate(repo.root);
    expect(calls).toEqual([
      "prettier --check .",
      "eslint . --max-warnings 0",
      "next typegen",
      "tsc --noEmit",
      "audit",
      "depcruise src --config .dependency-cruiser.json",
      "knip",
      "jscpd src tooling --config .jscpd.json",
      "vitest run",
      "next build",
      "playwright test",
    ]);
    expect(run.mock.calls.every(([, step]) => !step.command.some((arg) => arg.includes("HARNESS_FAST_LINT")))).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.preExisting).toEqual([]);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["src-shape", "knip-failed"]);
    expect(result.report).toContain("src/shared/lib/");
    expect(result.report).toContain("Unused exports");
    expect(result.report).toContain("playwright: passed");
  });

  it("reports every successful step", async () => {
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(makeRepo().root);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.report.match(/: passed/g)).toHaveLength(11);
  });

  it("reports an audit exception and still reaches the browser step", async () => {
    vi.spyOn(auditor, "audit").mockImplementation(() => {
      throw new Error("Cannot read source");
    });
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(makeRepo().root);
    expect(result.passed).toBe(false);
    expect(result.report).toContain("Cannot read source");
    expect(result.report).toContain("playwright: passed");
  });
});
