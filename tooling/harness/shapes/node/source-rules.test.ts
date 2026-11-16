import { describe, expect, it } from "vitest";
import { auditSource } from "../../core/audit/content-rules.ts";
import { BACKEND_PACKAGES } from "../../core/audit/backend-packages.ts";
import { ts } from "../../tools/typescript.ts";
import { nodeContent } from "./content.ts";
import { NODE_LAYOUT, nodeSourceRules } from "./source-rules.ts";

const rules = (path: string, text: string): string[] =>
  nodeSourceRules(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), ts).map(({ rule }) => rule);
const audit = (path: string, text: string): string[] =>
  auditSource("/nowhere", { file: path, path, profile: nodeContent, backendPackages: BACKEND_PACKAGES }, text).map(({ rule }) => rule);
const lines = (count: number): string => "export const x = 1;\n".repeat(count);

describe("the node-service source rules", () => {
  it.each([
    'import { a } from "./a.js";',
    'import { a } from "./a";',
    'import { env } from "#/shared/lib/env";',
    'export * from "./b";',
    'export { c } from "../c.mjs";',
    'const m = await import("./lazy");',
    "const m = await import(`./lazy`);",
    'import { env } from "@/shared/lib/env.ts";',
  ])("reports %s as node-import", (text) => {
    expect(rules("src/modules/ads/data/ads.ts", text)).toEqual(["node-import"]);
  });

  it.each([
    'import { a } from "./a.ts";',
    'import { env } from "#/shared/lib/env.ts";',
    'import rows from "./rows.json" with { type: "json" };',
    'import { Hono } from "hono";',
    'import fs from "node:fs";',
    'import { doc } from "@acme/doc";',
  ])("passes %s", (text) => {
    expect(rules("src/modules/ads/data/ads.ts", text)).toEqual([]);
  });

  it("judges src/ only", () => {
    expect(rules("scripts/seed.ts", 'import { a } from "./a";')).toEqual([]);
  });

  it("reports import.meta.env and server-only, which belong to other runtimes", () => {
    expect(rules("src/main.ts", "const mode = import.meta.env.MODE;")).toEqual(["env-access"]);
    expect(rules("src/main.ts", 'const mode = import.meta["env"].MODE;')).toEqual(["env-access"]);
    expect(rules("src/main.ts", "const { env } = import.meta;")).toEqual(["env-access"]);
    expect(rules("src/main.ts", "const here = import.meta.dirname;")).toEqual([]);
    expect(rules("src/main.ts", 'import "server-only";')).toEqual(["server-only"]);
  });

  it.each([
    ["./a.mts", "./a.ts"],
    ["./a.cts", "./a.ts"],
    ["./a.tsx", "./a.ts"],
    ["../c.mjs", "../c.ts"],
    ["#/shared/lib/env", "#/shared/lib/env.ts"],
  ])("advises %s as %s", (specifier, advised) => {
    const source = ts.createSourceFile("x.ts", `import { a } from "${specifier}";`, ts.ScriptTarget.Latest, true);
    expect(nodeSourceRules("src/main.ts", source, ts).map(({ message }) => message)).toEqual([expect.stringContaining(`(${advised})`)]);
  });

  it("keeps app.ts and each routes.ts at 80 lines", () => {
    for (const file of ["src/app/app.ts", "src/modules/ads/routes.ts"]) {
      expect(rules(file, lines(80)), file).toEqual([]);
      expect(rules(file, lines(81)), file).toEqual(["thin-route"]);
    }
    expect(rules("src/modules/ads/data/ads.ts", lines(81))).toEqual([]);
  });

  it("ends every message with the layout", () => {
    const source = ts.createSourceFile("x.ts", 'import { a } from "./a";', ts.ScriptTarget.Latest, true);
    for (const { message } of nodeSourceRules("src/main.ts", source, ts)) expect(message.endsWith(NODE_LAYOUT)).toBe(true);
  });
});

describe("the core content rules with the node-service profile", () => {
  it("reads process.env in src/shared/lib/env.ts only", () => {
    expect(audit("src/main.ts", "export const port = process.env.PORT;\n")).toEqual(["env-access"]);
    expect(audit("src/shared/lib/env.ts", "export const port = process.env.PORT;\n")).toEqual([]);
  });

  it("leaves the clock of an integration test alone, not of a unit test", () => {
    expect(audit("src/modules/ads/data/ads.int.test.ts", "export const now = Date.now();\n")).toEqual([]);
    expect(audit("src/modules/ads/data/ads.test.ts", "export const now = Date.now();\n")).toEqual(["test-determinism"]);
  });

  it("keeps backend packages in src/backend/, and relative imports inside src/", () => {
    expect(audit("src/modules/ads/routes.ts", 'import { createClient } from "@supabase/supabase-js";\n')).toEqual(["backend-package"]);
    expect(audit("src/backend/client.ts", 'import { createClient } from "@supabase/supabase-js";\n')).toEqual([]);
    expect(audit("src/modules/ads/data/ads.ts", 'import { doc } from "../../../../../packages/doc/src/index.ts";\n')).toEqual(["package-boundary"]);
  });

  it("reports Next directives", () => {
    expect(audit("src/modules/ads/routes.ts", '"use server";\nexport const a = 1;\n')).toEqual(["use-server-placement"]);
    expect(audit("src/modules/ads/routes.ts", '"use client";\nexport const a = 1;\n')).toEqual(["use-client-placement"]);
  });

  it("asks for a domain rule's test and a message written for the client", () => {
    expect(audit("src/modules/ads/domain/price.ts", "export const price = 1;\n")).toEqual(["domain-test"]);
    expect(audit("src/modules/ads/routes.ts", "try { run(); } catch (error) { answer(String(error)); }\n")).toEqual(["error-text"]);
  });
});
