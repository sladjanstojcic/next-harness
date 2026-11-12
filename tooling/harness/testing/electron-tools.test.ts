import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analysisOf, loadConfig } from "../config.ts";
import { audit } from "../core/audit/audit.ts";
import { toolScripts } from "../core/init/tool-configs.ts";
import { resolveHarness } from "../core/path-check.ts";
import { harnessRuleBlocks } from "../presets/eslint-rules.ts";
import { harnessKnipElectron } from "../presets/knip.ts";
import { eslintPresetLines, expectedRules, exportsCall, presetCall } from "../tools/eslint-preset.ts";
import { aliasesOf, cruiserAliases, fullTypecheck, incrementalTypecheck, reportTypecheck, typecheckProjects } from "../tools/typescript.ts";
import { ELECTRON_CONFIG, DESK_APP } from "./electron-repo.ts";
import { makeRepo } from "./temp-repo.ts";

const ELECTRON = { path: "", shape: "electron-vite", next: false } as const;
const R = "src/renderer/src";
const project = (files: Record<string, string> = {}) => makeRepo({ ...DESK_APP, "harness.config.ts": ELECTRON_CONFIG, ...files });
const strictness = (root: string): string[] =>
  audit(root)
    .filter(({ rule }) => rule === "tsconfig-strict")
    .map(({ file, message }) => `${file} ${message.split(" ")[0] ?? ""}`);

describe("the type check of an electron-vite workspace", () => {
  it("runs tsc once per project its tsconfig.json refers to, in one step", () => {
    const { root } = project();
    const projects = typecheckProjects(root, ELECTRON);
    expect(projects).toEqual(["tsconfig.node.json", "tsconfig.web.json"]);
    const tsc = path.join(root, "node_modules/.bin/tsc");
    const loop = 'tsc=$1; flags=$2; shift 2; status=0; for project; do "$tsc" --noEmit $flags -p "$project" || status=1; done; exit $status';
    expect(fullTypecheck(root, false, projects).map(({ name, command }) => ({ name, command }))).toEqual([
      { name: "tsc", command: ["/bin/sh", "-c", loop, "sh", tsc, "", ...projects] },
    ]);
    expect(reportTypecheck(root, false, projects)[0]?.command.slice(5)).toEqual(["--pretty false", ...projects]);
    expect(incrementalTypecheck(root, false, projects)[0]?.command.slice(5)).toEqual(["--incremental --pretty false", ...projects]);
    expect(toolScripts({ ...ELECTRON, tools: "eslint-prettier" }, root).typecheck).toBe(
      "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    );
  });

  it("stays the plain tsc run for a tsconfig that names its own files, and for every other shape", () => {
    const plain = project({ "tsconfig.json": '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n' });
    expect(typecheckProjects(plain.root, ELECTRON)).toEqual([]);
    expect(typecheckProjects(project().root, { shape: "next-modules" })).toEqual([]);
    expect(typecheckProjects(project().root, { shape: "package" })).toEqual([]);
    expect(fullTypecheck(plain.root, false, [])[0]?.command).toEqual([path.join(plain.root, "node_modules/.bin/tsc"), "--noEmit"]);
  });

  it("judges each referenced project's strictness instead of reporting that tsconfig.json checks nothing", () => {
    expect(strictness(project().root)).toEqual([]);
    const lax = project({
      "tsconfig.web.json": DESK_APP["tsconfig.web.json"]?.replace('"strict": true,', '"strict": true, "noImplicitAny": false,') ?? "",
      "tsconfig.node.json": DESK_APP["tsconfig.node.json"]?.replace('"strict": true,', '"strict": true, "noCheck": true,') ?? "",
    });
    expect(strictness(lax.root)).toEqual(["tsconfig.node.json compilerOptions.noCheck", "tsconfig.web.json compilerOptions.noImplicitAny"]);
    const finding = audit(lax.root).find(({ file }) => file === "tsconfig.web.json");
    expect(finding?.message).toContain("in the options in force for this tsconfig.web.json");
  });

  it("still reports a tsconfig.json that checks nothing and refers to nothing", () => {
    const empty = project({ "tsconfig.json": '{ "files": [] }\n' });
    expect(strictness(empty.root)).toEqual(["tsconfig.json This"]);
  });
});

describe("the ESLint preset for the electron layout", () => {
  const restricted = (file: string): string => JSON.stringify(expectedRules(file, "electron")["no-restricted-imports"] ?? "none");

  it("is asked for by the lines init prints, without its base when the project's config brings typescript-eslint", () => {
    const own = DESK_APP["eslint.config.mjs"] ?? "";
    expect(exportsCall(own)).toBe(true);
    expect(exportsCall("export default defineConfig([\n  a,\n]);\n")).toBe(false);
    expect(exportsCall("export default [a];\n")).toBe(false);
    expect(presetCall(ELECTRON)).toBe('harnessEslint({ root: import.meta.dirname, layout: "electron" })');
    expect(eslintPresetLines(ELECTRON, own)).toEqual([
      'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";',
      '...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false }),',
    ]);
  });

  it("gives each part its own import boundary", () => {
    expect(restricted(`${R}/modules/notes/components/form.tsx`)).toContain("Window code runs in a browser page without Node or Electron");
    expect(restricted(`${R}/modules/notes/components/form.tsx`)).not.toContain("may import none");
    expect(restricted(`${R}/shared/lib/money.ts`)).toContain("is used by every module and may import none");
    expect(restricted(`${R}/modules/notes/domain/total.ts`)).toContain("A domain/ rule is plain TypeScript");
    expect(restricted(`${R}/modules/notes/domain/total.test.ts`)).not.toContain("A domain/ rule is plain TypeScript");
    expect(restricted("src/shared/notes.ts")).toContain("All three parts load src/shared/");
    expect(restricted("src/main/storage/client.ts")).toContain("they take no window code and no React");
    expect(restricted("src/preload/index.ts")).toContain("A preload script is the bridge and nothing more");
    expect(restricted("electron.vite.config.ts")).toBe('"none"');
  });

  const patterns = (file: string, aliases?: Parameters<typeof expectedRules>[2]): RegExp[] => {
    const [, options] = expectedRules(file, "electron", aliases)["no-restricted-imports"] as ["error", { patterns: { regex: string }[] }];
    return options.patterns.map(({ regex }) => new RegExp(regex, "u"));
  };
  const denies = (file: string, specifier: string, aliases?: Parameters<typeof expectedRules>[2]): boolean =>
    patterns(file, aliases).some((pattern) => pattern.test(specifier));

  it("allows the bridge's own imports in src/preload/ and no other package or alias", () => {
    for (const allowed of ["electron", "electron/renderer", "@shared/notes", "./api", "../shared/notes"])
      expect(denies("src/preload/index.ts", allowed), allowed).toBe(false);
    for (const other of ["node:path", "path", "@/shared/lib/money", "react", "@electron-toolkit/preload"])
      expect(denies("src/preload/index.ts", other), other).toBe(true);
  });

  it("judges packages and aliases only: a relative path is dependency-cruiser's, so an area folder named main or modules is no finding", () => {
    expect(denies(`${R}/modules/notes/components/side/row.tsx`, "../main/panel")).toBe(false);
    expect(denies(`${R}/shared/components/layout/frame.tsx`, "../modules/menu")).toBe(false);
    expect(denies("src/main/storage/client.ts", "../../renderer/src/app")).toBe(false);
    expect(denies(`${R}/shared/components/layout/frame.tsx`, "@/modules/notes")).toBe(true);
    expect(denies("src/main/storage/client.ts", "@/shared/lib/money")).toBe(true);
    expect(denies("src/shared/notes.ts", "@/shared/lib/money")).toBe(true);
  });

  it("builds the alias patterns from the paths the project declares, wherever its tsconfig projects hold them", () => {
    const { root } = project();
    const aliases = aliasesOf(root);
    expect({ renderer: aliases.renderer, contract: aliases.contract }).toEqual({ renderer: ["@renderer/"], contract: ["@shared/"] });
    expect(Object.keys(aliases.paths).sort()).toEqual(["@renderer/*", "@shared/*"]);
    expect(aliases.paths["@renderer/*"]).toEqual([path.join(root, "src/renderer/src/*")]);
    expect(denies("src/main/storage/client.ts", "@renderer/shared/lib/money", aliases)).toBe(true);
    expect(denies(`${R}/shared/lib/money.ts`, "@renderer/modules/notes", aliases)).toBe(true);
    expect(denies("src/main/storage/client.ts", "@/shared/lib/money", aliases)).toBe(false);
    expect(denies("src/preload/index.ts", "@shared/notes", aliases)).toBe(false);
    // Without a readable tsconfig the layout's own two aliases stand.
    const bare = makeRepo();
    expect(aliasesOf(bare.root)).toEqual({ renderer: ["@/"], contract: ["@shared/"], paths: {} });
    expect(cruiserAliases(bare.root, ELECTRON)).toEqual([]);
    expect(cruiserAliases(root, { shape: "next-modules" })).toEqual([]);
  });

  it("hands dependency-cruiser one tsconfig with every alias, in a folder git ignores", () => {
    const { root } = project();
    expect(cruiserAliases(root, ELECTRON)).toEqual(["--ts-config", "node_modules/.cache/harness/tsconfig.aliases.json"]);
    const written = JSON.parse(fs.readFileSync(path.join(root, "node_modules/.cache/harness/tsconfig.aliases.json"), "utf8")) as Record<string, unknown>;
    expect(written).toEqual({
      extends: path.join(root, "tsconfig.json"),
      compilerOptions: { paths: { "@shared/*": [path.join(root, "src/shared/*")], "@renderer/*": [path.join(root, "src/renderer/src/*")] } },
    });
  });

  it("keeps casts to the main process and the contract's guards, and console output to automation", () => {
    const blocks = harnessRuleBlocks("electron");
    expect(blocks[1]?.ignores).toEqual(["src/{main,shared}/**"]);
    expect(expectedRules("src/shared/notes.ts", "electron")["@typescript-eslint/no-unsafe-type-assertion"]).toBeUndefined();
    expect(expectedRules(`${R}/app.tsx`, "electron")["@typescript-eslint/no-unsafe-type-assertion"]).toBe("error");
    // The same ban as no-console, as a rule whose message says where logging belongs.
    const banned = expectedRules("src/main/index.ts", "electron");
    expect(banned["no-console"]).toBe("off");
    expect(JSON.stringify(banned["no-restricted-properties"])).toContain("src/main/logging/log.ts");
    // Preload and renderer cannot import that helper, so their message does not send them to it.
    for (const file of [`${R}/app.tsx`, "src/preload/index.ts"]) {
      const outside = JSON.stringify(expectedRules(file, "electron")["no-restricted-properties"]);
      expect(outside, file).toContain("Do not log here: let the error throw, or send it to the main process over a channel");
      expect(outside, file).not.toContain("Log through a file named log.ts");
    }
    expect(JSON.stringify(expectedRules("src/shared/notes.ts", "electron")["no-restricted-properties"])).toContain("src/main/logging/log.ts");
    for (const file of ["src/main/logging/log.ts", "scripts/release.ts"])
      expect(expectedRules(file, "electron")["no-restricted-properties"], file).toBeUndefined();
  });
});

describe("the knip preset for an electron-vite workspace", () => {
  it("names the entries of the three processes and ignores the generated code and harness.config.ts", () => {
    const { root } = project();
    expect(harnessKnipElectron(root)).toEqual({
      entry: ["electron.vite.config.ts", "src/main/index.ts", "src/preload/index.ts", "src/renderer/index.html", `${R}/main.tsx`],
      ignore: [`${R}/shared/ui/**`, "harness.config.ts", "tooling/harness/**"],
      ignoreDependencies: [],
    });
  });

  it("lists only what exists, and reads the harness as a workspace package where it is one", () => {
    const repo = makeRepo({
      "package.json": '{ "devDependencies": { "electron-vite": "6.0.0" } }\n',
      "pnpm-workspace.yaml": "packages:\n  - tooling/harness\n",
      "src/main/index.ts": "",
    });
    expect(harnessKnipElectron(repo.root)).toEqual({
      ignoreWorkspaces: ["tooling/harness"],
      workspaces: { ".": { entry: ["src/main/index.ts"], ignore: [], ignoreDependencies: [] } },
    });
  });
});

describe("an electron-vite workspace in harness.config.ts", () => {
  it("is refused with next: true", () => {
    const repo = makeRepo({ "harness.config.ts": 'export default { workspaces: [{ path: ".", shape: "electron-vite", next: true }] };\n' });
    expect(() => loadConfig(repo.root)).toThrow("harness.config.ts: workspaces.0.next must not be true for the electron-vite shape, which is not a Next app");
  });

  it("takes the eslint-prettier tools and all three analysis tools by default", () => {
    const { root } = project();
    const harness = resolveHarness(root);
    expect(harness.workspaces.map(({ path: at, shape, tools, next }) => ({ path: at, shape, tools, next }))).toEqual([
      { ...ELECTRON, tools: "eslint-prettier" },
    ]);
    const [workspace] = harness.workspaces;
    expect(workspace === undefined ? [] : analysisOf(loadConfig(root), workspace)).toEqual(["depcruise", "knip", "jscpd"]);
  });
});
