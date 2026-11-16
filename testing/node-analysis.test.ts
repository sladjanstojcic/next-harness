import { describe, expect, it } from "vitest";
import { analysisOf } from "../config.ts";
import { runTool } from "../core/gates/run-tool.ts";
import { harnessKnipNode } from "../presets/knip.ts";
import { harnessVitest } from "../presets/vitest.ts";
import { depcruise } from "../tools/analysis.ts";
import { consumerRepo } from "./template-repo.ts";
import { makeRepo } from "./temp-repo.ts";

const SERVICE = { path: "", shape: "node-service", tools: "eslint-prettier", next: false } as const;
const ADS = "src/modules/ads";

/** A service whose module calls the backend from data/, with #/ imports and relative ones, each naming its .ts file. */
const PASSING: Record<string, string> = {
  "package.json": '{ "name": "ad-api", "type": "module", "imports": { "#/*": "./src/*" } }\n',
  "tsconfig.json":
    '{ "compilerOptions": { "strict": true, "module": "nodenext", "noEmit": true, "allowImportingTsExtensions": true, "verbatimModuleSyntax": true }, "include": ["src"] }\n',
  ".dependency-cruiser.json": '{\n  "extends": "./tooling/harness/presets/dependency-cruiser-node.json"\n}\n',
  "src/main.ts": 'import { readFileSync } from "node:fs";\nimport { createApp } from "#/app/app.ts";\n\nexport const main = [createApp, readFileSync];\n',
  "src/app/app.ts": 'import { adsRoutes } from "#/modules/ads/index.ts";\n\nexport const createApp = (): unknown => adsRoutes;\n',
  [`${ADS}/index.ts`]: 'export { adsRoutes } from "./routes.ts";\nexport type { Ad } from "./types.ts";\n',
  [`${ADS}/types.ts`]: 'import type { Database } from "#/backend/database.types.ts";\n\nexport type Ad = Database["ads"];\n',
  [`${ADS}/routes.ts`]:
    'import type { Database } from "#/backend/database.types.ts";\nimport { listAds } from "./data/ads.ts";\n\nexport type Row = Database["ads"];\nexport const adsRoutes = listAds;\n',
  [`${ADS}/data/ads.ts`]:
    'import { readFile } from "node:fs/promises";\nimport { db } from "#/backend/client.ts";\nimport { price } from "../domain/price.ts";\n\nexport const listAds = (): unknown => [db, price, readFile];\n',
  [`${ADS}/domain/price.ts`]: "export const price = (cents: number): number => cents * 2;\n",
  "src/backend/client.ts": 'import { env } from "#/shared/lib/env.ts";\n\nexport const db = { url: env };\n',
  "src/backend/database.types.ts": "export type Database = { ads: { id: string } };\n",
  "src/shared/lib/env.ts": "export const env = 'x';\n",
};

/** One file per rule, and what each breaks. */
const BREAKING: Record<string, string> = {
  "src/shared/lib/first.ts": 'import { second } from "./second.ts";\n\nexport const first = (): number => second() + 1;\n',
  "src/shared/lib/second.ts": 'import { first } from "./first.ts";\n\nexport const second = (): number => (first.length > 2 ? first() : 0);\n',
  "src/shared/lib/up.ts": 'import { adsRoutes } from "#/modules/ads/index.ts";\n\nexport const up = adsRoutes;\n',
  "src/app/disk.ts": 'import { readFileSync } from "node:fs";\n\nexport const disk = readFileSync;\n',
  [`${ADS}/schemas.ts`]: 'import { db } from "#/backend/client.ts";\n\nexport const schema = db;\n',
  [`${ADS}/domain/disk.ts`]:
    'import { readFileSync } from "node:fs";\nimport { listAds } from "../data/ads.ts";\n\nexport const disk = [readFileSync, listAds];\n',
  "src/backend/up.ts": 'import { createApp } from "../app/app.ts";\n\nexport const up = createApp;\n',
  "src/modules/cart/index.ts": 'import { price } from "../ads/domain/price.ts";\n\nexport const cart = price;\n',
  [`${ADS}/domain/price.test.ts`]: 'import { price } from "./price.ts";\n\nexport const doubled = price(1);\n',
  [`${ADS}/domain/uses-test.ts`]: 'import { doubled } from "./price.test.ts";\n\nexport const usesTest = doubled;\n',
};

const cruise = async (root: string) =>
  runTool(
    root,
    depcruise.report(root, SERVICE, new Set(), () => undefined),
  );
const named = async (root: string): Promise<string[]> => (await cruise(root)).map(({ rule, file }) => `${rule} ${file}`);

describe("dependency-cruiser for a node-service workspace", () => {
  it("passes the service as written, #/ imports and type-only imports of the generated types included", async () => {
    expect(await named(consumerRepo(PASSING).root)).toEqual([]);
  }, 120_000);

  it("finds each boundary, and names the layout in the advice", async () => {
    const repo = consumerRepo({ ...PASSING, ...BREAKING });
    const found = await named(repo.root);
    expect(found.filter((entry) => entry.startsWith("no-circular src/shared/lib/")).length).toBeGreaterThan(0);
    expect([...new Set(found.filter((entry) => !entry.startsWith("no-circular")))].sort()).toEqual(
      [
        "shared-not-up src/shared/lib/up.ts",
        "edge-no-node src/app/disk.ts",
        `backend-from-data-only ${ADS}/schemas.ts`,
        `domain-no-node ${ADS}/domain/disk.ts`,
        `domain-pure-path ${ADS}/domain/disk.ts`,
        "backend-own-code src/backend/up.ts",
        "module-public-api src/modules/cart/index.ts",
        `not-to-test ${ADS}/domain/uses-test.ts`,
      ].sort(),
    );
    for (const { message, rule } of await cruise(repo.root)) expect(message, rule).toMatch(/\(Node layout\)\.?$/);
  }, 120_000);

  it("runs in a node-service workspace by default", () => {
    expect(analysisOf({ workspaces: [] }, SERVICE)).toEqual(["depcruise", "knip", "jscpd"]);
  });
});

describe("the knip and Vitest presets for a node-service workspace", () => {
  it("names the entries that exist and ignores the generated types", () => {
    const files = { "src/main.ts": "", "src/backend/client.ts": "", "harness.config.ts": "" };
    expect(harnessKnipNode(makeRepo({ ...files, "src/worker.ts": "" }).root)).toMatchObject({
      entry: ["src/main.ts", "src/worker.ts"],
      ignore: ["src/backend/*.types.ts", "src/backend/*-types.ts", "harness.config.ts", "tooling/harness/**"],
    });
    expect(harnessKnipNode(makeRepo(files).root)).toMatchObject({ entry: ["src/main.ts"] });
  });

  it("leaves the integration tests out when asked, and keeps Vitest's own exclusions", () => {
    expect(harnessVitest({ integration: false }).test.exclude).toEqual(["**/node_modules/**", "**/.git/**", "**/*.int.test.ts"]);
    expect(harnessVitest().test).not.toHaveProperty("exclude");
  });
});
