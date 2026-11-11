import { describe, expect, it } from "vitest";
import { makeRepo } from "./temp-repo.ts";
import { harnessKnip, harnessKnipPackage, harnessKnipWorkspace } from "../presets/knip.ts";

const PACKAGE = JSON.stringify({ dependencies: { "server-only": "0.0.1" }, devDependencies: { "@eslint/js": "9.39.5", eslint: "9.39.5" } });

describe("the knip preset", () => {
  it("lists only the entries, ignores and dependencies a project has", () => {
    const repo = makeRepo({ "package.json": PACKAGE, "src/shared/lib/env.ts": "export const env = {};\n" });
    expect(harnessKnip(repo.root)).toEqual({
      next: true,
      entry: ["src/shared/lib/env.ts"],
      ignore: ["tooling/harness/**"],
      ignoreDependencies: ["server-only", "@eslint/js"],
    });
  });

  it("gives its settings to the root workspace where the harness is a workspace package", () => {
    const repo = makeRepo({ "package.json": PACKAGE, "pnpm-workspace.yaml": "packages:\n  - tooling/harness\n", "src/shared/ui/button.tsx": "" });
    expect(harnessKnip(repo.root)).toEqual({
      ignoreWorkspaces: ["tooling/harness"],
      workspaces: { ".": { next: true, entry: [], ignore: ["src/shared/ui/**"], ignoreDependencies: ["server-only", "@eslint/js"] } },
    });
  });

  it("names the configs and script binaries of a tool installed above the workspace, and nothing once the workspace lists the tool", () => {
    const app = { scripts: { format: "prettier --write .", lint: "eslint .", test: "vitest run" }, devDependencies: { eslint: "9.39.5" } };
    const files = { "node_modules/.bin/prettier": "", "node_modules/.bin/eslint": "", "apps/web/prettier.config.ts": "", "apps/web/eslint.config.js": "" };
    const repo = makeRepo({ ...files, "apps/web/package.json": JSON.stringify(app) });
    const dir = `${repo.root}/apps/web`;
    expect(harnessKnipWorkspace({ harness: "analyse" }, dir)).toEqual({
      next: true,
      entry: [],
      ignore: ["prettier.config.ts"],
      ignoreDependencies: [],
      ignoreBinaries: ["prettier"],
    });
    repo.write("apps/web/package.json", JSON.stringify({ ...app, devDependencies: { eslint: "9.39.5", prettier: "3.9.10" } }));
    expect(harnessKnipWorkspace({ harness: "analyse" }, dir)).toEqual({ next: true, entry: [], ignore: [], ignoreDependencies: [] });
  });

  it("names tsc where the workspace lists typescript as the TypeScript 6 alias, whose binary is tsc6", () => {
    const app = { scripts: { "check-types": "next typegen && tsc --noEmit" }, devDependencies: { typescript: "npm:@typescript/typescript6@^6.0.2" } };
    const repo = makeRepo({ "node_modules/.bin/tsc": "", "apps/web/node_modules/.bin/tsc6": "", "apps/web/package.json": JSON.stringify(app) });
    const dir = `${repo.root}/apps/web`;
    expect(harnessKnipWorkspace({ harness: "analyse" }, dir).ignoreBinaries).toEqual(["tsc"]);
    repo.write("apps/web/node_modules/.bin/tsc", "");
    expect(harnessKnipWorkspace({ harness: "analyse" }, dir).ignoreBinaries).toBeUndefined();
  });

  it("leaves the harness to analysis in the harness's own repository; the preset's tools have no import there either", () => {
    const repo = makeRepo({ "package.json": PACKAGE });
    const analysed = { next: true, entry: [], ignore: [], ignoreDependencies: ["server-only", "@eslint/js"] };
    expect(harnessKnipWorkspace({ harness: "analyse" }, repo.root)).toEqual(analysed);
  });

  it("does not ignore a preset tool the project's own ESLint config imports", () => {
    const repo = makeRepo({ "package.json": PACKAGE, "eslint.config.mjs": 'import js from "@eslint/js";\nexport default [js.configs.recommended];\n' });
    expect(harnessKnipWorkspace({}, repo.root).ignoreDependencies).toEqual(["server-only"]);
  });

  it("gives a package the files its exports point at as entries, and judges their exports too", () => {
    const manifest = {
      name: "@repo/billing",
      exports: {
        ".": "./src/index.ts",
        "./server": { types: "./src/server.ts", default: "./src/server.ts" },
        "./gone": "./src/gone.ts",
        "./ui/*": "./src/ui/*.tsx",
      },
      dependencies: { "server-only": "0.0.1" },
      devDependencies: { knip: "6.44.1" },
      scripts: { format: "prettier --write ." },
    };
    const files = {
      "packages/billing/src/index.ts": "",
      "packages/billing/src/server.ts": "",
      "packages/billing/prettier.config.ts": "",
      "node_modules/.bin/prettier": "",
    };
    const repo = makeRepo({ ...files, "packages/billing/package.json": JSON.stringify(manifest) });
    expect(harnessKnipPackage(`${repo.root}/packages/billing`)).toEqual({
      entry: ["src/index.ts", "src/server.ts", "src/ui/*.tsx"],
      includeEntryExports: true,
      ignore: ["prettier.config.ts"],
      ignoreDependencies: ["server-only"],
      ignoreBinaries: ["prettier"],
    });
  });
});
