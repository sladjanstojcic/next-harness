import { describe, expect, it } from "vitest";
import { BACKEND_PACKAGES } from "../../core/audit/backend-packages.ts";
import { auditSource } from "../../core/audit/content-rules.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { viteContent } from "./content.ts";
import { VITE_LAYOUT } from "./source-rules.ts";

const root = makeRepo().root;
const found = (file: string, source: string, pageLines = Number.POSITIVE_INFINITY) =>
  auditSource(root, { file, path: file, profile: viteContent, pageLines, backendPackages: BACKEND_PACKAGES }, source);
const rules = (file: string, source: string): string[] => found(file, source).map(({ rule }) => rule);

describe("import.meta.env", () => {
  const cases: [string, string, number][] = [
    ["src/shared/lib/env.ts", "export const env = schema.parse(import.meta.env);", 0],
    ["src/modules/ads/data/ads.ts", "const url = import.meta.env.VITE_API_URL;", 1],
    ["src/app/page.tsx", "const { env } = import.meta;", 1],
    ["src/modules/ads/components/a.tsx", "configure(import.meta.env);", 1],
    ["src/modules/ads/components/a.tsx", "const hot = import.meta.hot;", 0],
    ["vite.config.ts", "const mode = import.meta.env.MODE;", 0],
    ["src/modules/ads/data/ads.test.ts", 'const url = import.meta["env"].VITE_API_URL;', 1],
  ];

  it.each(cases)("in %s, %s gives %i finding(s) naming src/shared/lib/env.ts", (file, source, count) => {
    const findings = found(file, `${source}\n`);
    expect(findings).toHaveLength(count);
    for (const finding of findings) {
      expect(finding.rule).toBe("env-access");
      expect(finding.message).toContain("src/shared/lib/env.ts");
      expect(finding.message.endsWith(VITE_LAYOUT)).toBe(true);
    }
  });
});

describe("the vite-spa content profile", () => {
  it('reports "server-only" under src/', () => {
    const findings = found("src/modules/ads/data/ads.ts", 'import "server-only";\n');
    expect(findings.map(({ rule, line }) => `${rule}:${String(line)}`)).toEqual(["server-only:1"]);
    expect(findings[0]?.message.endsWith(VITE_LAYOUT)).toBe(true);
  });

  it("reports the Next directives, process.env, a long page and a backend package outside src/backend/", () => {
    expect(rules("src/modules/ads/components/a.tsx", '"use client";\nexport const A = 1;\n')).toEqual(["use-client-placement"]);
    expect(rules("src/modules/ads/data/ads.ts", '"use server";\nexport const save = async () => {};\n')).toEqual(["use-server-placement"]);
    expect(rules("src/main.tsx", "const key = process.env.X;\n")).toEqual(["env-access"]);
    expect(rules("src/shared/lib/env.ts", "export const key = process.env.X;\n")).toEqual(["env-access"]);
    const page = `${Array.from({ length: 61 }, (_, index) => `export const a${String(index)} = ${String(index)};`).join("\n")}\n`;
    expect(found("src/app/page.tsx", page, 60).map(({ rule }) => rule)).toEqual(["thin-page"]);
    expect(rules("src/modules/ads/components/a.tsx", 'import PocketBase from "pocketbase";\nexport const pb = new PocketBase();\n')).toEqual([
      "backend-package",
    ]);
    expect(rules("src/backend/client.ts", 'import PocketBase from "pocketbase";\nexport const pb = new PocketBase();\n')).toEqual([]);
  });

  it("judges a module's domain/ rule for its test and shows no raw error text in src/app/ and components/", () => {
    expect(rules("src/modules/ads/domain/pricing.ts", "export const price = 1;\n")).toEqual(["domain-test"]);
    expect(rules("src/modules/ads/components/a.tsx", "export const show = (error: Error) => error.message;\n")).toEqual(["error-text"]);
    expect(rules("src/modules/ads/data/ads.ts", "export const show = (error: Error) => error.message;\n")).toEqual([]);
  });

  it("ends every message with the layout", () => {
    for (const text of Object.values(viteContent.messages)) expect(text.endsWith(VITE_LAYOUT), text).toBe(true);
    expect(viteContent.backend?.message.endsWith(VITE_LAYOUT)).toBe(true);
  });
});
