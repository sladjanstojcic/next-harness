import path from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { initHarness } from "../core/init/init.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";
import { linkWorkspacePackages, TURBO_APPS, TURBO_FILES, TURBO_LEGACY } from "./turbo-repo.ts";

export const TURBO_PRESET = 'import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";';
const call = (layout: string): string => `harnessEslint({ root: import.meta.dirname, layout: "${layout}", toolsFrom: "@repo/eslint-config" })`;
/** The two lines init prints in place of each kept config's `export default <name>;`. */
export const TURBO_APP_LINES = [`const harnessConfig = [...[nextJsConfig].flat(), ...${call("app-root")}];`, "export default harnessConfig;"];
export const TURBO_UI_LINES = [`const harnessConfig = [...[config].flat(), ...${call("package")}];`, "export default harnessConfig;"];

/** What init's install line puts into a workspace's package.json; Prettier stays at the root, as create-turbo installs it. */
const TOOLS = {
  "dependency-cruiser": "18.7.2",
  "eslint-config-prettier": "10.1.8",
  jscpd: "5.4.2",
  knip: "6.44.1",
  "typescript-eslint": "8.72.1",
  vitest: "5.1.0",
};
const PACKAGES = ["packages/ui", "packages/billing"];
const versions = z.record(z.string(), z.string()).optional();
const packageJson = z.looseObject({ dependencies: versions, devDependencies: versions });

/** create-turbo's project before any legacy list, with the workspace packages linked as an install leaves them. */
export function turboProject() {
  const repo = consumerRepo(Object.fromEntries(Object.entries(TURBO_FILES).filter(([file]) => file !== TURBO_LEGACY)));
  linkWorkspacePackages(repo.root);
  return repo;
}

/**
 * That project after `init --starter` and its printed steps: the harness's tools in each workspace's package.json, the
 * starter files' runtime packages in each app, the two lines in each kept ESLint config, and one format run.
 */
export function adoptedTurbo() {
  const repo = turboProject();
  const { report, ok } = initHarness(repo.root, { force: false, starter: true });
  expect(ok, report).toBe(true);
  for (const workspace of [...TURBO_APPS, ...PACKAGES]) {
    const manifest = packageJson.parse(JSON.parse(repo.read(`${workspace}/package.json`)));
    const runtime = PACKAGES.includes(workspace) ? {} : { zod: "4.6.7", "server-only": "0.0.1" };
    const next = { ...manifest, dependencies: { ...manifest.dependencies, ...runtime }, devDependencies: { ...manifest.devDependencies, ...TOOLS } };
    repo.write(`${workspace}/package.json`, `${JSON.stringify(next, null, 2)}\n`);
  }
  for (const app of TURBO_APPS) {
    const own = repo.read(`${app}/eslint.config.js`);
    repo.write(`${app}/eslint.config.js`, `${TURBO_PRESET}\n${own.replace("export default nextJsConfig;", TURBO_APP_LINES.join("\n"))}`);
  }
  repo.write(
    "packages/ui/eslint.config.mjs",
    `${TURBO_PRESET}\n${repo.read("packages/ui/eslint.config.mjs").replace("export default config;", TURBO_UI_LINES.join("\n"))}`,
  );
  for (const workspace of [...TURBO_APPS, ...PACKAGES]) {
    const format = run(path.join(repo.root, workspace), "prettier", ["--write", "."]);
    expect(format.status, format.output).toBe(0);
  }
  return { ...repo, report };
}
