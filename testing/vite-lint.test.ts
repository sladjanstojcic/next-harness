import { describe, expect, it } from "vitest";
import { runTool } from "../core/gates/run-tool.ts";
import { VITE_PROBES } from "../shapes/vite/vite-spa.ts";
import { eslintPreset, presetCall } from "../tools/eslint-preset.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";

const SPA = { path: "", shape: "vite-spa", next: false } as const;
const THIN =
  'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, layout: "spa" });\n';
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    lib: ["dom", "esnext"],
    strict: true,
    noEmit: true,
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    types: ["node"],
    paths: { "@/*": ["./src/*"] },
  },
  include: ["src/**/*.ts", "src/**/*.tsx"],
});
/** The files the rows import, so every import resolves and only the boundaries speak. */
const TARGETS = {
  "package.json": JSON.stringify({ name: "ad-board", type: "module" }),
  "tsconfig.json": TSCONFIG,
  "src/backend/database.types.ts": "export interface Ad {\n  id: string;\n}\n",
  "src/modules/ads/index.ts": "export const a = 1;\n",
};

/** One file per row: the folder and the import of the brief's table, and the one rule expected there, if any. */
const ROWS: [file: string, code: string, expected: string[]][] = [
  ["src/modules/ads/components/a.tsx", 'import { pb } from "@/backend/client";\n\nexport const used = pb;\n', ["no-restricted-imports"]],
  ["src/modules/ads/components/b.tsx", 'import type { Ad } from "@/backend/database.types";\n\nexport type Used = Ad;\n', []],
  ["src/modules/ads/data/ads.ts", 'import { pb } from "@/backend/client";\n\nexport const used = pb;\n', []],
  ["src/app/page.tsx", 'import { pb } from "@/backend/client";\n\nexport const used = pb;\n', ["no-restricted-imports"]],
  ["src/shared/lib/x.ts", 'import { a } from "@/modules/ads";\n\nexport const used = a;\n', ["no-restricted-imports"]],
  ["src/backend/client.ts", 'import { useState } from "react";\n\nexport const pb = 1;\nexport const used = useState;\n', ["no-restricted-imports"]],
  ["src/modules/ads/domain/p.ts", 'import { useState } from "react";\n\nexport const used = useState;\n', ["no-restricted-imports"]],
  ["src/modules/ads/data/files.ts", 'import fs from "node:fs";\n\nexport const used = fs;\n', ["no-restricted-imports"]],
  ["src/modules/ads/components/c.tsx", "console.log(1);\n", ["no-console"]],
  ["src/shared/lib/log.ts", "console.error(1);\n", []],
];

interface Result {
  filePath: string;
  messages: { ruleId: string | null; message: string }[];
}

const project = (config = THIN) => consumerRepo({ ...TARGETS, ...Object.fromEntries(ROWS.map(([file, code]) => [file, code])), "eslint.config.ts": config });

describe("the ESLint boundaries of a vite-spa workspace", () => {
  it("keep the backend client to data/ and src/backend/, React out of the backend and domain, and Node out of src/", () => {
    const { root } = project();
    const results = JSON.parse(run(root, "eslint", ["-f", "json", ...ROWS.map(([file]) => file)]).output) as Result[];
    const found = (file: string) => results.find(({ filePath }) => filePath.endsWith(file))?.messages ?? [{ ruleId: "not linted", message: "" }];
    expect(ROWS.map(([file]) => [file, [...new Set(found(file).map(({ ruleId }) => ruleId))]])).toEqual(ROWS.map(([file, , expected]) => [file, expected]));
    for (const [file] of ROWS)
      for (const { ruleId, message } of found(file)) if (ruleId === "no-restricted-imports") expect(message.endsWith("(Vite layout)"), message).toBe(true);
  }, 120_000);
});

describe("the preset presence check of a vite-spa workspace", () => {
  it("probes the shape's own paths and reports each rule a config without the preset leaves out", async () => {
    const step = eslintPreset("/project", SPA, () => "probe");
    expect(step.command.slice(3)).toEqual(VITE_PROBES.map((probe) => probe.replaceAll("{name}", "probe")));
    expect(presetCall(SPA)).toBe('harnessEslint({ root: import.meta.dirname, layout: "spa" })');

    const { root } = project();
    expect(await runTool(root, eslintPreset(root, SPA))).toEqual([]);
    const bare = project('import tseslint from "typescript-eslint";\n\nexport default tseslint.config(...tseslint.configs.recommended);\n');
    const missing = await runTool(bare.root, eslintPreset(bare.root, SPA));
    expect(missing.length).toBeGreaterThan(0);
    expect(new Set(missing.map(({ rule }) => rule))).toEqual(new Set(["preset-missing"]));
    expect(missing.map(({ message }) => message.split(" ")[0])).toContain("no-restricted-imports");
  }, 240_000);
});
