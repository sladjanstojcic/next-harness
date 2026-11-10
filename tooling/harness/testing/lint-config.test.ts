import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { templateRepo } from "./template-repo.ts";

let root: string;
beforeEach(() => {
  root = templateRepo().root;
});

function folder(area: string): string {
  mkdirSync(join(root, area), { recursive: true });
  const path = mkdtempSync(join(root, area, "harness-"));
  return relative(root, path);
}

function write(file: string, source: string): string {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, { flag: "wx" });
  return file;
}

function run(tool: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(join(root, "node_modules/.bin", tool), args, { cwd: root, encoding: "utf8", timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

function cruise(paths: string[]): { status: number | null; output: string } {
  return run("depcruise", [...paths, "--config", ".dependency-cruiser.json", "--output-type", "err-long"]);
}

describe("real ESLint configuration", () => {
  it("rejects unsafe types, floating promises, TS suppression and inline disables", () => {
    const modulePath = folder("src/modules");
    const file = write(
      `${modulePath}/components/bad.ts`,
      [
        "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
        "export const unsafe: any = JSON.parse('{}');",
        "unsafe.value();",
        "export function unsafeReturn() { return unsafe; }",
        "export function take(value: number) { return value; }",
        "take(unsafe);",
        "Promise.resolve(1);",
        "// @ts-ignore",
        "export const ignored: number = 'text';",
        "// @ts-expect-error: prohibited even with a description",
        "export const expected: number = 'text';",
      ].join("\n"),
    );
    const result = run("eslint", [file, "--max-warnings", "0"]);
    expect(result.status, result.output).toBe(1);
    for (const rule of [
      "no-explicit-any",
      "no-unsafe-assignment",
      "no-unsafe-member-access",
      "no-unsafe-call",
      "no-unsafe-return",
      "no-unsafe-argument",
      "no-floating-promises",
      "ban-ts-comment",
    ]) {
      expect(result.output).toContain(`@typescript-eslint/${rule}`);
    }
    expect(result.output).toContain("no effect because you have 'noInlineConfig'");
  }, 120_000);

  it("forbids never casts, narrowing assertions, computed imports and require", () => {
    const modulePath = folder("src/modules");
    const file = write(
      `${modulePath}/components/workaround.ts`,
      [
        'export const forced = "text" as never;',
        "export function narrow(value: unknown): string {",
        "  return value as string;",
        "}",
        "export function load(name: string): Promise<unknown> {",
        "  return import(`./${name}.ts`);",
        "}",
        'export const legacy: unknown = require("node:fs");',
      ].join("\n"),
    );
    const result = run("eslint", [file, "--max-warnings", "0"]);
    expect(result.status, result.output).toBe(1);
    for (const text of ["casting to never", "@typescript-eslint/no-unsafe-type-assertion", "literal path", "require() hides"]) {
      expect(result.output).toContain(text);
    }
  }, 120_000);

  it("counts all 251 lines", () => {
    const modulePath = folder("src/modules");
    const file = write(`${modulePath}/components/long.ts`, Array(251).fill("// counted").join("\n"));
    const result = run("eslint", [file, "--max-warnings", "0"]);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("max-lines");
  }, 120_000);

  it("forbids stars, unsafe assertions and console output outside the accepted exceptions", () => {
    const modulePath = folder("src/modules");
    write(`${modulePath}/types.ts`, "export type Data = { value: number };");
    const file = write(
      `${modulePath}/components/bad.ts`,
      [
        'export * from "../types";',
        "export const object = {} as { value: number };",
        "export const double = 1 as unknown as string;",
        "export const nonNull = [1][0]!;",
        "console.log(object); eval('1'); new Function('return 1');",
        'export function branch(value: "a" | "b") { switch (value) { case "a": return 1; } }',
      ].join("\n"),
    );
    const result = run("eslint", [file, "--max-warnings", "0"]);
    expect(result.status, result.output).toBe(1);
    for (const rule of [
      "no-restricted-syntax",
      "consistent-type-assertions",
      "no-non-null-assertion",
      "no-console",
      "no-eval",
      "no-new-func",
      "switch-exhaustiveness-check",
    ]) {
      expect(result.output).toContain(rule);
    }
  }, 120_000);

  it("permits server assertions and non-null assertions in tests", () => {
    const modulePath = folder("src/modules");
    const server = write(`${modulePath}/server/value.ts`, "export const object = {} as { value: number }; export const cast = 1 as unknown as string;");
    const test = write(`${modulePath}/server/value.test.ts`, "export const value = [1][0]!;");
    const tooling = folder("tooling/harness");
    const cli = write(`${tooling}/log.ts`, 'console.log("allowed");');
    const result = run("eslint", [server, test, cli, "--max-warnings", "0"]);
    expect(result.status, result.output).toBe(0);
  }, 120_000);
});

describe("real dependency-cruiser configuration", () => {
  it("blocks deep cross-module imports, including type-only edges and app imports", () => {
    const a = folder("src/modules");
    const b = folder("src/modules");
    write(`${b}/server/get-b.ts`, "export type B = string; export const b = 1;");
    write(`${a}/components/x.tsx`, `import type { B } from "@/modules/${basename(b)}/server/get-b"; export type A = B;`);
    const app = folder("src/app");
    write(`${app}/page.tsx`, `export { b as default } from "@/modules/${basename(b)}/server/get-b";`);
    const result = cruise([a, b, app]);
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain("module-public-api");
    expect(result.output).toContain(`${a}/components/x.tsx`);
    expect(result.output).toContain(`${app}/page.tsx`);
  }, 120_000);

  it.each(["proxy.ts", "instrumentation.ts", "instrumentation-client.ts"])(
    "enforces public module imports from root entry %s",
    (entry) => {
      write("src/modules/orders/server/get-order.ts", "export const order = 1;");
      write("src/modules/orders/index.ts", "export { order } from './server/get-order';");
      write(`src/${entry}`, 'export { order } from "@/modules/orders/server/get-order";');
      const blocked = cruise([`src/${entry}`]);
      expect(blocked.status, blocked.output).toBe(1);
      expect(blocked.output).toContain("module-public-api");
      writeFileSync(join(root, `src/${entry}`), 'export { order } from "@/modules/orders";');
      const allowed = cruise([`src/${entry}`]);
      expect(allowed.status, allowed.output).toBe(0);
    },
    120_000,
  );

  it("allows same-module internals and all three public entry points", () => {
    const a = folder("src/modules");
    const b = folder("src/modules");
    write(`${b}/index.ts`, "export const b = 1;");
    write(`${b}/server.ts`, "export const query = 2;");
    write(`${b}/actions/save-b-action.ts`, "export const save = 3;");
    write(`${a}/server/get-a.ts`, "export const a = 4;");
    write(
      `${a}/components/x.tsx`,
      [
        `export { b } from "@/modules/${basename(b)}";`,
        `export { query } from "@/modules/${basename(b)}/server";`,
        `export { save } from "@/modules/${basename(b)}/actions/save-b-action";`,
        'export { a } from "../server/get-a";',
      ].join("\n"),
    );
    const result = cruise([a, b]);
    expect(result.status, result.output).toBe(0);
  }, 120_000);

  it("detects public-API cycles and shared-to-module imports", () => {
    const a = folder("src/modules");
    const b = folder("src/modules");
    write(`${a}/index.ts`, `export { b } from "@/modules/${basename(b)}"; export const a = 1;`);
    write(`${b}/index.ts`, `export { a } from "@/modules/${basename(a)}"; export const b = 1;`);
    const shared = folder("src/shared/components");
    write(`${shared}/x.ts`, `export { a } from "@/modules/${basename(a)}";`);
    const result = cruise([a, b, shared]);
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain("no-circular");
    expect(result.output).toContain("shared-not-modules");
  }, 120_000);

  it("rejects I/O and React in domain code, and production imports of tests", () => {
    const a = folder("src/modules");
    write(`${a}/server/query.ts`, "export const query = 1;");
    write(`${a}/domain/total.test.ts`, "export const fixture = 1;");
    write(`${a}/domain/total.ts`, 'import "react"; import "next/headers"; import "node:fs"; import "../server/query"; import "./total.test";');
    const result = cruise([a]);
    expect(result.status, result.output).toBe(5);
    expect(result.output).toContain("domain-pure-core");
    expect(result.output).toContain("domain-pure-path");
    expect(result.output).toContain("not-to-test");
  }, 120_000);
});

it("knip reports an unused export in a reachable module", () => {
  const modulePath = folder("src/modules");
  write(`${modulePath}/index.ts`, "export const usedThing = 1; export const unusedThing = 2;");
  const app = folder("src/app");
  write(`${app}/page.tsx`, `import { usedThing } from "@/modules/${basename(modulePath)}"; export default function Page() { return usedThing; }`);
  const result = run("knip", ["--config", "knip.config.ts", "--reporter", "json"]);
  expect(result.status, result.output).toBe(1);
  expect(result.output).toContain("unusedThing");
  expect(result.output).not.toContain('"name":"usedThing"');
}, 120_000);

it("jscpd rejects a copied 30-line block and writes a JSON report", () => {
  const a = folder("src/modules");
  const b = folder("src/modules");
  const block = `export function copy(input: number) {\n${Array.from({ length: 30 }, (_, i) => `  input += ${i};`).join("\n")}\nreturn input;\n}`;
  write(`${a}/domain/a.ts`, block);
  write(`${b}/domain/b.ts`, block);
  const output = `.next/jscpd/${basename(a)}`;
  const result = run("jscpd", [a, b, "--output", output]);
  expect(result.status, result.output).toBe(1);
  const report = readFileSync(join(root, output, "jscpd-report.json"), "utf8");
  expect(report).toContain("a.ts");
  expect(report).toContain("b.ts");
}, 120_000);
