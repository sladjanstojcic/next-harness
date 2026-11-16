import { describe, expect, it } from "vitest";
import { runTool } from "../core/gates/run-tool.ts";
import { NODE_PROBES } from "../shapes/node/node-service.ts";
import { eslintPreset, presetCall } from "../tools/eslint-preset.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";

const SERVICE = { path: "", shape: "node-service", next: false } as const;
const THIN =
  'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, layout: "service" });\n';
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    strict: true,
    noEmit: true,
    module: "nodenext",
    allowImportingTsExtensions: true,
    erasableSyntaxOnly: true,
    verbatimModuleSyntax: true,
    types: ["node"],
  },
  include: ["src"],
});
/** The files the rows import, so every import resolves and only the boundaries speak. */
const TARGETS = {
  "package.json": JSON.stringify({ name: "ad-api", type: "module", imports: { "#/*": "./src/*" } }),
  "tsconfig.json": TSCONFIG,
  "src/backend/client.ts": "export const db = { from: (table: string): string => table };\n",
  "src/backend/database.types.ts": "export interface Ad {\n  id: string;\n}\n",
  "src/modules/ads/index.ts": "export const ads = 1;\n",
};

const VALUE = 'import { db } from "#/backend/client.ts";\n\nexport const used = db;\n';
const TYPE = 'import type { Ad } from "#/backend/database.types.ts";\n\nexport type Row = Ad;\n';
const FS = 'import { readFileSync } from "node:fs";\n\nexport const used = readFileSync;\n';
const BARE_FS = 'import { readFileSync } from "fs";\n\nexport const used = readFileSync;\n';

/** One file per row, and the one rule expected there, if any. */
const ROWS: [file: string, code: string, expected: string[]][] = [
  ["src/modules/ads/routes.ts", VALUE, ["no-restricted-imports"]],
  ["src/modules/ads/schemas.ts", TYPE, []],
  ["src/app/app.ts", VALUE, ["no-restricted-imports"]],
  ["src/modules/ads/domain/price.ts", VALUE, ["no-restricted-imports"]],
  ["src/modules/ads/domain/row.ts", TYPE, []],
  ["src/modules/ads/data/ads.ts", VALUE, []],
  ["src/main.ts", VALUE, ["no-restricted-imports"]],
  ["src/modules/ads/data/files.ts", FS, []],
  ["src/backend/files.ts", FS, []],
  ["src/shared/lib/files.ts", FS, []],
  ["src/worker.ts", FS, []],
  ["src/modules/ads/types.ts", FS, ["no-restricted-imports"]],
  ["src/app/disk.ts", FS, ["no-restricted-imports"]],
  ["src/modules/cart/routes.ts", BARE_FS, ["no-restricted-imports"]],
  ["src/modules/ads/domain/disk.ts", FS, ["no-restricted-imports"]],
  ["src/modules/ads/domain/disk.test.ts", FS, []],
  ["src/shared/lib/up.ts", 'import { ads } from "#/modules/ads/index.ts";\n\nexport const used = ads;\n', ["no-restricted-imports"]],
  ["src/shared/lib/db.ts", VALUE, ["no-restricted-imports"]],
  ["src/backend/up.ts", 'import { ads } from "#/modules/ads/index.ts";\n\nexport const used = ads;\n', ["no-restricted-imports"]],
  ["src/modules/ads/data/view.ts", 'import { useState } from "react";\n\nexport const used = useState;\n', ["no-restricted-imports"]],
  ["src/modules/ads/data/log.ts", "console.log(1);\n", ["no-console"]],
  ["src/shared/lib/log.ts", "console.error(1);\n", []],
];

interface Result {
  filePath: string;
  messages: { ruleId: string | null; message: string }[];
}

const project = (config = THIN) => consumerRepo({ ...TARGETS, ...Object.fromEntries(ROWS.map(([file, code]) => [file, code])), "eslint.config.ts": config });

describe("the ESLint boundaries of a node-service workspace", () => {
  it("keep the backend client to data/, Node out of the HTTP edge and the domain, and React out of the service", () => {
    const { root } = project();
    const results = JSON.parse(run(root, "eslint", ["-f", "json", ...ROWS.map(([file]) => file)]).output) as Result[];
    const found = (file: string) => results.find(({ filePath }) => filePath.endsWith(file))?.messages ?? [{ ruleId: "not linted", message: "" }];
    expect(ROWS.map(([file]) => [file, [...new Set(found(file).map(({ ruleId }) => ruleId))]])).toEqual(ROWS.map(([file, , expected]) => [file, expected]));
    for (const [file] of ROWS)
      for (const { ruleId, message } of found(file)) if (ruleId === "no-restricted-imports") expect(message.endsWith("(Node layout)"), message).toBe(true);
  }, 120_000);
});

describe("the preset presence check of a node-service workspace", () => {
  it("probes the shape's own paths and reports a config without the preset", async () => {
    const step = eslintPreset("/project", SERVICE, () => "probe");
    expect(step.command.slice(3)).toEqual(NODE_PROBES.map((probe) => probe.replaceAll("{name}", "probe")));
    expect(presetCall(SERVICE)).toBe('harnessEslint({ root: import.meta.dirname, layout: "service" })');
    const { root } = project();
    expect(await runTool(root, eslintPreset(root, SERVICE))).toEqual([]);
    const bare = project('import tseslint from "typescript-eslint";\n\nexport default tseslint.config(...tseslint.configs.recommended);\n');
    const missing = await runTool(bare.root, eslintPreset(bare.root, SERVICE));
    expect(new Set(missing.map(({ rule }) => rule))).toEqual(new Set(["preset-missing"]));
  }, 240_000);
});
