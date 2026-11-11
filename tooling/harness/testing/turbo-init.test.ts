import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { audit } from "../core/audit/audit.ts";
import { runTool } from "../core/gates/run-tool.ts";
import { initHarness } from "../core/init/init.ts";
import { initLegacy } from "../core/legacy.ts";
import { resolveHarness } from "../core/path-check.ts";
import { bringsOwnBase, eslintPreset, eslintPresetLines } from "../tools/eslint-preset.ts";
import { placeStep } from "../tools/tool-set.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";
import { linkWorkspacePackages, TURBO_APPS, TURBO_FILES, TURBO_LEGACY, TURBO_LEGACY_FILES } from "./turbo-repo.ts";

const APP = { path: "apps/web", shape: "next-modules", next: true, sourceRoot: "" } as const;
const UI = { path: "packages/ui", shape: "package", next: false } as const;
const APP_TOOLS = {
  "dependency-cruiser": "18.7.2",
  "eslint-config-prettier": "10.1.8",
  jscpd: "5.4.2",
  knip: "6.44.1",
  "typescript-eslint": "8.72.1",
  vitest: "5.1.0",
};
const PRESET = 'import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";';
const APP_LINE =
  'export default [...[nextJsConfig].flat(), ...harnessEslint({ root: import.meta.dirname, layout: "app-root", base: false, toolsFrom: "@repo/eslint-config" })];';
const UI_LINE =
  'export default [...[config].flat(), ...harnessEslint({ root: import.meta.dirname, layout: "package", base: false, toolsFrom: "@repo/eslint-config" })];';

/** create-turbo's project before any legacy list, with the workspace packages linked as an install leaves them. */
function project() {
  const repo = consumerRepo(Object.fromEntries(Object.entries(TURBO_FILES).filter(([file]) => file !== TURBO_LEGACY)));
  linkWorkspacePackages(repo.root);
  return repo;
}

describe("init --starter in a create-turbo project, then its printed steps", () => {
  it("prints lines a config that exports a name can take, with base: false read through the workspace package", () => {
    const repo = project();
    const dir = path.join(repo.root, APP.path);
    expect(bringsOwnBase(dir)).toBe(true);
    expect(bringsOwnBase(path.join(repo.root, UI.path))).toBe(true);
    expect(eslintPresetLines(APP, repo.read("apps/web/eslint.config.js"), dir)).toEqual([PRESET, APP_LINE]);
    const { report } = initHarness(repo.root, { force: false, starter: true });
    expect(report).toContain(
      `kept apps/web/eslint.config.js: your config stays; add the harness preset to it, the import at the top of the file, the second line in place of \`export default nextJsConfig\`:\n    ${PRESET}\n    ${APP_LINE}`,
    );
    expect(report).toContain(`the second line in place of \`export default config\`:\n    ${PRESET}\n    ${UI_LINE}`);
    expect(report).not.toMatch(/pnpm add -D [^\n]*(?:eslint-config-next|@eslint\/js)/);
    expect(report).toContain('updated apps/web/tsconfig.json: compilerOptions.allowImportingTsExtensions: true, compilerOptions.paths "@/*": ["./*"]');
    expect(report).not.toContain("updated packages/ui/tsconfig.json: compilerOptions.allowImportingTsExtensions: true, compilerOptions.paths");
  });

  it("leaves a project whose tools pass on every file init wrote: legacy init lists only what create-turbo wrote", async () => {
    const repo = project();
    const { report, ok } = initHarness(repo.root, { force: false, starter: true });
    expect(ok, report).toBe(true);
    const workspaces = [...TURBO_APPS, "packages/ui", "packages/billing"];
    // The printed steps: the harness's tools and the starter files' runtime packages in each app (Prettier stays at the
    // root, as create-turbo installs it), the two lines in each kept ESLint config, one format run.
    for (const app of TURBO_APPS) {
      const manifest = JSON.parse(repo.read(`${app}/package.json`)) as { dependencies: object; devDependencies: object };
      const dependencies = { ...manifest.dependencies, zod: "4.6.7", "server-only": "0.0.1" };
      const devDependencies = { ...manifest.devDependencies, ...APP_TOOLS };
      repo.write(`${app}/package.json`, `${JSON.stringify({ ...manifest, dependencies, devDependencies }, null, 2)}\n`);
      const own = repo.read(`${app}/eslint.config.js`);
      repo.write(`${app}/eslint.config.js`, `${PRESET}\n${own.replace("export default nextJsConfig;", APP_LINE)}`);
    }
    repo.write("packages/ui/eslint.config.mjs", `${PRESET}\n${repo.read("packages/ui/eslint.config.mjs").replace("export default config;", UI_LINE)}`);
    for (const workspace of workspaces) {
      const format = run(path.join(repo.root, workspace), "prettier", ["--write", "."]);
      expect(format.status, format.output).toBe(0);
    }

    for (const workspace of [APP, UI]) {
      const dir = path.join(repo.root, workspace.path);
      const step = placeStep(repo.root, workspace.path, eslintPreset(dir, workspace));
      expect("finding" in step ? step.finding : await runTool(repo.root, step), workspace.path).toEqual([]);
    }
    const tests = run(path.join(repo.root, APP.path), "vitest", ["run"]);
    expect(tests.status, tests.output).toBe(0);
    expect(stripVTControlCharacters(tests.output)).toMatch(/Test Files +5 passed/);

    const written = (finding: { file: string }): boolean => !TURBO_LEGACY_FILES.includes(finding.file);
    expect(audit(repo.root).filter(written)).toEqual([]);
    const outcome = await initLegacy(repo.root, resolveHarness(repo.root));
    expect(outcome).not.toContain("did not run to the end");
    const listed = (JSON.parse(fs.readFileSync(path.join(repo.root, TURBO_LEGACY), "utf8")) as { files: string[] }).files;
    expect(listed).toEqual([...TURBO_LEGACY_FILES].sort());
  }, 600_000);
});
