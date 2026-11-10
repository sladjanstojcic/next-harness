import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { templateRepo } from "../../testing/template-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { audit, auditChanged } from "../audit/audit.ts";
import { fastGate } from "./fast-gate.ts";

let root: string;
const area = "src/modules/tmp-fast";
beforeEach(() => {
  root = templateRepo().root;
  fs.mkdirSync(path.join(root, area), { recursive: true });
});
function write(file: string, source: string): string {
  const relative = `${area}/${file}`;
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), source, { flag: "wx" });
  return relative;
}

function largeFunction(name: string, parameter: string): string {
  return `export function ${name}(${parameter}: number): number {
  const doubled = ${parameter} * 2;
  const increased = doubled + 1;
  if (increased > 10) return increased - 3;
  return increased + doubled + ${parameter} + 1;
}
`;
}

describe("fast gate with the template tools", () => {
  it("leaves duplicate exports to Done and CI instead of parsing the whole tree per edit", async () => {
    const original = write("domain/calculate-a.ts", largeFunction("calculate", "value"));
    const copy = write("domain/calculate-b.ts", largeFunction("compute", "input"));
    const result = await fastGate(root, [copy]);
    expect(result.findings.some((finding) => finding.rule === "duplicate-export")).toBe(false);
    expect(audit(root)).toContainEqual(
      expect.objectContaining({ rule: "duplicate-export", file: copy, message: expect.stringContaining(original) as unknown }),
    );
  }, 120_000);

  it("leaves domain-test to Done and CI: blocks f8ef27, 828988 wrote the rule one call before its test", async () => {
    const rule = write("domain/total.ts", "export const total = (values: number[]): number => values.reduce((sum, value) => sum + value, 0);\n");
    const finding: unknown = expect.objectContaining({ rule: "domain-test", file: rule });
    expect((await fastGate(root, [rule])).findings).not.toContainEqual(finding);
    expect(auditChanged(root, [rule])).not.toContainEqual(finding);
    expect(audit(root)).toContainEqual(finding);
  }, 120_000);

  it("leaves git-ignored writes silent and unchanged", async () => {
    fs.appendFileSync(path.join(root, ".gitignore"), "\n.superpowers/\n");
    const file = ".superpowers/sdd/report.ts";
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "export const ignored={x:1}");
    expect(await fastGate(root, [file])).toEqual({ passed: true, findings: [], preExisting: [], report: "" });
    expect(fs.readFileSync(path.join(root, file), "utf8")).toBe("export const ignored={x:1}");
  });

  it("reports explicit any with a path and a rendered report", async () => {
    const file = write("components/unsafe.ts", "export type Value = any;\n");
    const result = await fastGate(root, [file]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "@typescript-eslint/no-explicit-any", file }));
    expect(result.preExisting).toEqual([]);
    expect(result.report).toContain(`${file}:1 @typescript-eslint/no-explicit-any`);
  }, 120_000);

  it("keeps syntax checks in Fast and typed checks in the default Done and CI configuration", async () => {
    const file = write("components/lint-levels.ts", "export type Value = any;\nPromise.resolve(1);\n");
    const fast = await fastGate(root, [file]);
    expect(fast.findings).toContainEqual(expect.objectContaining({ rule: "@typescript-eslint/no-explicit-any", file }));
    expect(fast.findings.some((finding) => finding.rule === "@typescript-eslint/no-floating-promises")).toBe(false);
    const typed = spawnSync(path.join(root, "node_modules/.bin/eslint"), ["--format", "json", "--no-warn-ignored", file], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(typed.status, typed.stderr).toBe(1);
    expect(typed.stdout).toContain('"ruleId":"@typescript-eslint/no-floating-promises"');
    expect(typed.stdout).toContain('"ruleId":"@typescript-eslint/no-explicit-any"');
  }, 120_000);

  it("formats valid code and limits findings to selected paths", async () => {
    const file = write("components/valid.ts", "export const value={a:1}");
    const other = write("components/unselected.ts", "export type Bad=any");
    const result = await fastGate(root, [path.join(root, file), file]);
    expect(result).toEqual({ passed: true, findings: [], preExisting: [], report: "" });
    expect(fs.readFileSync(path.join(root, file), "utf8")).toBe("export const value = { a: 1 };\n");
    expect(fs.readFileSync(path.join(root, other), "utf8")).toBe("export type Bad=any");
  }, 120_000);

  it("reports invalid module placement", async () => {
    const file = write("helpers/x.ts", "export const x = 1;\n");
    const result = await fastGate(root, [file]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "module-shape", file }));
  }, 120_000);

  it("counts all 251 lines", async () => {
    const file = write("components/long.ts", Array(251).fill("// counted").join("\n"));
    const result = await fastGate(root, [file]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "max-lines", file }));
  }, 120_000);

  it("reports the eleventh source file even when only that file is selected", async () => {
    for (let index = 0; index < 10; index++) write(`components/item-${index}.ts`, `export const item${index} = ${index};\n`);
    const file = write("components/eleventh.ts", "export const eleventh = 11;\n");
    const result = await fastGate(root, [file]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "folder-size", file }));
    expect(result.findings.every((finding) => finding.file === file)).toBe(true);
  }, 120_000);

  it("keeps ESLint warnings as findings", async () => {
    const file = write("components/preview.tsx", 'export function Preview() { return <img src="/fixture.png" alt="fixture" width={1} height={1} />; }');
    const result = await fastGate(root, [file]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "@next/next/no-img-element", file }));
  }, 120_000);

  it("skips missing files, directories, vendored files and outside-root symlinks", async () => {
    const outside = makeRepo({ "outside.ts": "export const outside={a:1}" });
    const alias = path.join(root, area, "outside.ts");
    fs.symlinkSync(path.join(outside.root, "outside.ts"), alias);
    const vendor = path.join(root, "src/shared/lib/utils.ts");
    const before = fs.readFileSync(vendor, "utf8");
    const result = await fastGate(root, ["src/missing.ts", area, alias, vendor, path.join(outside.root, "outside.ts")]);
    expect(result).toEqual({ passed: true, findings: [], preExisting: [], report: "" });
    expect(outside.read("outside.ts")).toBe("export const outside={a:1}");
    expect(fs.readFileSync(vendor, "utf8")).toBe(before);
  });

  it("leaves unsupported types unchanged", async () => {
    const file = write("components/payload.bin", "unformatted binary fixture");
    expect((await fastGate(root, [file])).passed).toBe(true);
    expect(fs.readFileSync(path.join(root, file), "utf8")).toBe("unformatted binary fixture");
  }, 120_000);

  it("checks absolute paths reached through a symlink to the repository root", async () => {
    const holder = makeRepo();
    const alias = path.join(holder.root, "template");
    fs.symlinkSync(root, alias);
    const file = write("components/aliased.ts", "export const aliased={value:1}");
    expect((await fastGate(alias, [path.join(alias, file)])).passed).toBe(true);
    expect(fs.readFileSync(path.join(root, file), "utf8")).toBe("export const aliased = { value: 1 };\n");
  }, 120_000);
});
