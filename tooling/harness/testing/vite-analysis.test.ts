import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditTsconfigs } from "../core/audit/tsconfig-rules.ts";
import { prettierIgnored } from "../core/init/ignore-files.ts";
import { toolConfigSteps } from "../core/init/tool-configs.ts";
import { runTool } from "../core/gates/run-tool.ts";
import { harnessKnipVite } from "../presets/knip.ts";
import { depcruise } from "../tools/analysis.ts";
import { checksByProject, typecheckProjects } from "../tools/typescript.ts";
import { consumerRepo } from "./template-repo.ts";
import { makeRepo } from "./temp-repo.ts";

const VITE = { path: "", shape: "vite-spa", tools: "eslint-prettier", next: false } as const;
const ADS = "src/modules/ads";

/** A Vite app with a backend client, a module that calls it from data/, and only relative imports. */
const PASSING: Record<string, string> = {
  "package.json": '{ "name": "ads", "type": "module" }\n',
  "tsconfig.json": '{ "compilerOptions": { "strict": true, "jsx": "react-jsx", "module": "esnext", "moduleResolution": "bundler" }, "include": ["src"] }\n',
  ".dependency-cruiser.json": '{\n  "extends": "./tooling/harness/presets/dependency-cruiser-vite.json"\n}\n',
  "src/main.tsx": 'import { router } from "./app/router";\n\nexport const main = router;\n',
  "src/app/router.tsx": 'import { adsList } from "../modules/ads/index";\n\nexport const router = adsList;\n',
  [`${ADS}/index.ts`]: 'export { adsList } from "./data/ads";\nexport type { Ad } from "./types";\n',
  [`${ADS}/types.ts`]: 'import type { Database } from "../../backend/database.types";\n\nexport type Ad = Database["ads"];\n',
  [`${ADS}/data/ads.ts`]: 'import { client } from "../../../backend/client";\n\nexport const adsList = (): unknown => client;\n',
  [`${ADS}/data/ads.test.ts`]:
    'import { client } from "../../../backend/client";\nimport { adsList } from "./ads";\n\nexport const both = [client, adsList];\n',
  [`${ADS}/domain/price.ts`]: "export const price = (cents: number): number => cents * 2;\n",
  [`${ADS}/components/view.tsx`]:
    'import { useState } from "react";\nimport type { Database } from "../../../backend/database.types";\nimport { price } from "../domain/price";\n\nexport type Row = Database["ads"];\nexport const view = [useState, price];\n',
  "src/backend/client.ts": 'import { format } from "../shared/lib/format";\n\nexport const client = { format };\n',
  "src/backend/database.types.ts": "export type Database = { ads: { id: string } };\n",
  "src/shared/lib/format.ts": "export const format = (value: number): string => String(value);\n",
};

/** One file per rule, and what each breaks. */
const BREAKING: Record<string, string> = {
  "src/shared/lib/first.ts": 'import { second } from "./second";\n\nexport const first = (): number => second() + 1;\n',
  "src/shared/lib/second.ts": 'import { first } from "./first";\n\nexport const second = (): number => (Math.random() > 2 ? first() : 0);\n',
  "src/shared/lib/disk.ts": 'import { readFileSync } from "node:fs";\n\nexport const disk = readFileSync;\n',
  "src/shared/lib/up.ts": 'import { adsList } from "../../modules/ads/index";\n\nexport const up = adsList;\n',
  [`${ADS}/components/list.tsx`]: 'import { client } from "../../../backend/client";\n\nexport const list = client;\n',
  "src/backend/bad.ts": 'import { useState } from "react";\nimport { router } from "../app/router";\n\nexport const bad = [useState, router];\n',
  "src/app/page.tsx": 'import { price } from "../modules/ads/domain/price";\n\nexport const page = price;\n',
  "src/modules/cart/index.ts": 'import { price } from "../ads/domain/price";\n\nexport const cart = price;\n',
  [`${ADS}/domain/bad.ts`]:
    'import { useState } from "react";\nimport { adsList } from "../data/ads";\nimport { client } from "../../../backend/client";\n\nexport const bad = [useState, adsList, client];\n',
  [`${ADS}/domain/price.test.ts`]: 'import { price } from "./price";\n\nexport const doubled = price(1);\n',
  [`${ADS}/domain/uses-test.ts`]: 'import { doubled } from "./price.test";\n\nexport const usesTest = doubled;\n',
};

const cruise = async (root: string): Promise<string[]> =>
  (
    await runTool(
      root,
      depcruise.report(root, VITE, new Set(), () => undefined),
    )
  ).map(({ rule, file }) => `${rule} ${file}`);

describe("dependency-cruiser for a vite-spa workspace", () => {
  it("passes the app as written, a type-only import of the generated types included", async () => {
    expect(await cruise(consumerRepo(PASSING).root)).toEqual([]);
  }, 120_000);

  it("finds each boundary, and names the layout in the advice", async () => {
    const repo = consumerRepo({ ...PASSING, ...BREAKING });
    const found = await cruise(repo.root);
    expect(found.filter((entry) => entry.startsWith("no-circular src/shared/lib/")).length).toBeGreaterThan(0);
    const count = (entry: string): number => found.filter((other) => other === entry).length;
    expect(Object.fromEntries([...new Set(found)].filter((entry) => !entry.startsWith("no-circular")).map((entry) => [entry, count(entry)]))).toEqual({
      "src-no-node src/shared/lib/disk.ts": 1,
      "shared-not-up src/shared/lib/up.ts": 1,
      [`backend-from-data-only ${ADS}/components/list.tsx`]: 1,
      [`backend-from-data-only ${ADS}/domain/bad.ts`]: 1,
      // React and a route.
      "backend-own-code src/backend/bad.ts": 2,
      "module-public-api src/app/page.tsx": 1,
      "module-public-api src/modules/cart/index.ts": 1,
      // React, data/ and the backend client.
      [`domain-pure-path ${ADS}/domain/bad.ts`]: 3,
      [`not-to-test ${ADS}/domain/uses-test.ts`]: 1,
    });
    const findings = await runTool(
      repo.root,
      depcruise.report(repo.root, VITE, new Set(), () => undefined),
    );
    for (const { message, rule } of findings) expect(message, rule).toMatch(/\(Vite layout\)\.?$/);
  }, 120_000);

  it("does not take a package's own data/, components/ or hooks/ folder for the module's", async () => {
    const repo = consumerRepo({ ...PASSING, [`${ADS}/domain/rows.ts`]: 'import { rows } from "tables/data/rows";\n\nexport const count = rows.length;\n' });
    // A package beside the repository, as a monorepo's hoisted node_modules holds it.
    const table = path.join(path.dirname(repo.root), "node_modules/tables");
    fs.mkdirSync(path.join(table, "data"), { recursive: true });
    fs.writeFileSync(path.join(table, "package.json"), '{ "name": "tables", "version": "1.0.0" }\n');
    fs.writeFileSync(path.join(table, "data/rows.js"), "export const rows = [];\n");
    expect(await cruise(repo.root)).toEqual([]);
  }, 120_000);

  it("reads the @/ alias from the project tsconfig.json refers to, and finds a boundary written with it", async () => {
    const repo = consumerRepo({
      ...PASSING,
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }\n',
      "tsconfig.app.json":
        '{ "compilerOptions": { "strict": true, "jsx": "react-jsx", "module": "esnext", "moduleResolution": "bundler", "paths": { "@/*": ["./src/*"] } }, "include": ["src"] }\n',
      "src/app/page.tsx": 'import { price } from "@/modules/ads/domain/price";\n\nexport const page = price;\n',
    });
    expect(await cruise(repo.root)).toEqual(["module-public-api src/app/page.tsx"]);
  }, 120_000);

  it("is checked project by project, as an Electron workspace is", () => {
    expect([checksByProject("vite-spa"), checksByProject("electron-vite"), checksByProject("next-modules"), checksByProject("package")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("the type check of a vite-spa workspace", () => {
  const SOLUTION = '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }\n';
  const project = (app: string) =>
    makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: ".", shape: "vite-spa" }] };\n',
      "tsconfig.json": SOLUTION,
      "tsconfig.app.json": `{ "compilerOptions": { ${app}"jsx": "react-jsx" }, "include": ["src"] }\n`,
      "tsconfig.node.json": '{ "compilerOptions": { "strict": true }, "include": ["vite.config.ts"] }\n',
    });

  it("runs tsc for each project its tsconfig.json refers to", () => {
    expect(typecheckProjects(project('"strict": true, ').root, VITE)).toEqual(["tsconfig.app.json", "tsconfig.node.json"]);
  });

  it("judges each referenced project's strictness", () => {
    expect(auditTsconfigs(project('"strict": true, ').root)).toEqual([]);
    expect(auditTsconfigs(project("").root).map(({ rule, file }) => `${rule} ${file}`)).toEqual(["tsconfig-strict tsconfig.app.json"]);
  });
});

describe("the ignore files of a vite-spa workspace", () => {
  it("keep Vite's build output and tsc's build info out of git, and the build output and generated code out of the format check", () => {
    const web = { ...VITE, path: "apps/web" };
    const repo = makeRepo({ "apps/web/package.json": "{}\n" });
    const gitignore = toolConfigSteps(repo.root, web, false, false).find(({ target }) => target === "apps/web/.gitignore");
    expect(gitignore?.detail).toBe("dist/, *.tsbuildinfo");
    expect(prettierIgnored(web)).toEqual(["pnpm-lock.yaml", "src/shared/ui", "dist", "src/backend/*.types.ts", "src/backend/*-types.ts"]);
  });
});

describe("the knip preset for a vite-spa workspace", () => {
  const app = { "index.html": "<div></div>\n", "src/main.tsx": "", "vite.config.ts": "", "src/shared/ui/button.tsx": "", "harness.config.ts": "" };

  it("names the entries that exist and ignores the generated code", () => {
    const backend = { "src/backend/client.ts": "", "src/shared/lib/utils.ts": "" };
    expect(harnessKnipVite(makeRepo({ ...app, ...backend }).root)).toEqual({
      entry: ["index.html", "src/main.tsx", "vite.config.ts"],
      ignore: ["src/shared/ui/**", "src/shared/lib/utils.ts", "src/backend/*.types.ts", "src/backend/*-types.ts", "harness.config.ts", "tooling/harness/**"],
      ignoreDependencies: [],
    });
  });

  it("leaves out an entry the project does not have", () => {
    const rest = Object.fromEntries(Object.entries(app).filter(([file]) => file !== "index.html"));
    const preset = harnessKnipVite(makeRepo(rest).root);
    expect("entry" in preset ? preset.entry : []).toEqual(["src/main.tsx", "vite.config.ts"]);
  });
});
