import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { templateRepo } from "../../testing/template-repo.ts";
import { doneGate } from "./done-gate.ts";
import * as runner from "./run-tool.ts";

afterEach(() => vi.restoreAllMocks());

describe("Done gate with template tools", () => {
  it("does not spawn any tools when nothing changed", async () => {
    const run = vi.spyOn(runner, "runTool");
    expect(await doneGate(makeRepo().root, [])).toEqual({ passed: true, findings: [], preExisting: [], report: "" });
    expect(run).not.toHaveBeenCalled();
  });
  it("blocks the eleventh source even when it sorts last", async () => {
    const repo = makeRepo(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`src/modules/a/components/file-${i}.ts`, "export {};\n"])));
    const changed = "src/modules/a/components/new-file.tsx";
    repo.write(changed, "export {};\n");
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await doneGate(repo.root, [changed]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "folder-size", file: changed }));
  });

  it("blocks a renamed export copy that sorts before the original", async () => {
    const changed = "src/modules/a/domain/calc.ts";
    const body = "(n: number) { const a = n * 2; const b = a + 1; if (b > 10) return b - 3; return b + a + n + 1; }";
    const repo = makeRepo({
      [changed]: `export function calc${body}`,
      "src/modules/a/domain/calc.test.ts": "export {};",
      "src/modules/b/domain/compute.ts": `export function compute${body}`,
      "src/modules/b/domain/compute.test.ts": "export {};",
    });
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await doneGate(repo.root, [changed]);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "duplicate-export", file: changed }));
    expect(result.passed).toBe(false);
  });

  it.each([
    [
      "module-public-api",
      {
        "src/modules/orders/components/total.ts": "export const total = 1;\n",
        "src/app/page.tsx": "import { total } from '../modules/orders/components/total';\nexport default function Page() { return <main>{total}</main>; }\n",
      },
      "src/app/page.tsx",
    ],
    [
      "module-public-api",
      {
        "src/modules/orders/components/total.ts": "export const total = 1;\n",
        "src/modules/cart/components/cart.ts": "export { total } from '../../orders/components/total';\n",
      },
      "src/modules/cart/components/cart.ts",
    ],
    [
      "no-circular",
      {
        "src/modules/first/index.ts": "export { value } from '../second';\n",
        "src/modules/second/index.ts": "export { value } from '../first';\n",
      },
      "src/modules/first/index.ts",
    ],
    [
      "shared-not-modules",
      {
        "src/modules/orders/index.ts": "export const value = 1;\n",
        "src/shared/lib/x.ts": "import { value } from '../../modules/orders';\nexport const shared = value;\n",
      },
      "src/shared/lib/x.ts",
    ],
  ] satisfies [string, Record<string, string>, string][])(
    "blocks %s from actual depcruise JSON (%#)",
    async (rule, files, changed) => {
      const repo = templateRepo(files);
      const result = await doneGate(repo.root, [changed]);
      expect(result.passed).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule, file: changed }));
      expect(
        result.findings.some((finding) => finding.rule.endsWith("-failed")),
        result.report,
      ).toBe(false);
    },
    120_000,
  );

  it("reports typed no-floating-promises even when Fast lint is enabled in the parent", async () => {
    const file = "src/app/page.tsx";
    const repo = templateRepo({ [file]: "Promise.resolve(1);\nexport default function Page() { return <main>Hello</main>; }\n" });
    vi.stubEnv("HARNESS_FAST_LINT", "1");
    try {
      const result = await doneGate(repo.root, [file]);
      expect(result.passed).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "@typescript-eslint/no-floating-promises", file }));
    } finally {
      vi.unstubAllEnvs();
    }
  }, 120_000);

  it("lists an unchanged implicit-any diagnostic without blocking a clean changed file", async () => {
    const old = "src/shared/lib/old.ts";
    const repo = templateRepo({ [old]: "export function previous(value) { return value; }\n" });
    const result = await doneGate(repo.root, ["src/app/page.tsx"]);
    expect(result.passed, result.report).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.preExisting).toContainEqual(expect.objectContaining({ rule: "TS7006", file: old, line: 1 }));
    expect(result.report).toContain("Outside this turn's files (not blocking)");
    expect(result.report).toContain("TS7006");
  }, 120_000);

  it("blocks an unchanged direct importer when a changed file removes an export", async () => {
    const changed = "src/shared/lib/values.ts";
    const importer = "src/app/page.tsx";
    const repo = templateRepo({
      [changed]: "export const current = 1;\nexport const removed = 2;\n",
      [importer]: "import { current, removed } from '../shared/lib/values';\nexport default function Page() { return <main>{current + removed}</main>; }\n",
    });
    repo.write(changed, "export const current = 1;\n");
    const result = await doneGate(repo.root, [changed]);
    expect(result.passed, result.report).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "TS2305", file: importer }));
    expect(result.preExisting.some((finding) => finding.rule === "TS2305" && finding.file === importer)).toBe(false);
  }, 120_000);

  it.each(["delete", "move"])(
    "blocks TS2307 in an unchanged importer after a file %s",
    async (operation) => {
      const changed = "src/shared/lib/values.ts";
      const importer = "src/app/page.tsx";
      const specifier = operation === "delete" ? "../shared/lib/values" : "@/shared/lib/values";
      const repo = templateRepo({
        [changed]: "export const value = 1;\n",
        [importer]: `import { value } from '${specifier}';\nexport default function Page() { return <main>{value}</main>; }\n`,
      });
      if (operation === "move") repo.write("src/shared/lib/renamed.ts", repo.read(changed));
      repo.remove(changed);
      const result = await doneGate(repo.root, operation === "move" ? [changed, "src/shared/lib/renamed.ts"] : [changed]);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "TS2307", file: importer }));
      expect(result.passed).toBe(false);
      expect(result.preExisting.some((finding) => finding.rule === "TS2307" && finding.file === importer)).toBe(false);
    },
    120_000,
  );

  it("blocks an unchanged transitive importer when an upstream type loses a property", async () => {
    const changed = "src/shared/lib/account.ts";
    const importer = "src/app/page.tsx";
    const repo = templateRepo({
      [changed]: "export const account = { name: 'Alice', active: true };\n",
      "src/shared/lib/summary.ts": "import { account } from './account';\nexport const summary = account;\n",
      [importer]: "import { summary } from '../shared/lib/summary';\nexport default function Page() { return <main>{summary.name}</main>; }\n",
    });
    repo.write(changed, "export const account = { active: true };\n");
    const result = await doneGate(repo.root, [changed]);
    expect(result.passed, result.report).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "TS2339", file: importer }));
    expect(result.preExisting.some((finding) => finding.rule === "TS2339" && finding.file === importer)).toBe(false);
  }, 120_000);

  it("reports unused exports and both sides of duplicates with remediation", async () => {
    const source = Array.from({ length: 12 }, (_, i) => `  const part${i} = value + ${i};`).join("\n");
    const first = "src/modules/first/components/calculate.ts";
    const second = "src/modules/second/components/compute.ts";
    const repo = templateRepo({
      [first]: `export function calculate(value: number) {\n${source}\n  return part11;\n}\n`,
      [second]: `export function compute(value: number) {\n${source}\n  return part11;\n}\n`,
      "src/app/page.tsx": "import { calculate } from '../modules/first';\nexport default function Page() { return <main>{calculate(1)}</main>; }\n",
      "src/modules/first/index.ts": "export { calculate } from './components/calculate';\nexport const unused = 123;\n",
    });
    const result = await doneGate(repo.root, [first, second, "src/modules/first/index.ts"]);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "jscpd", file: first }));
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "jscpd", file: second }));
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "knip-exports", file: "src/modules/first/index.ts" }));
    expect(result.report).toContain("Remove the unused export or import it where it is used.");
    expect(result.report).toContain("Remove the unused file or import it from an entry point.");
    expect(result.report).toContain("Remove the unused dependency from package.json or use it in the application.");
  }, 120_000);
});
