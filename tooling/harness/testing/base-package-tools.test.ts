import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandWorkspaces, loadConfig } from "../config.ts";
import { peerInstall } from "../core/init/peers.ts";
import { toolLoader } from "../presets/load-tool.ts";
import { eslintPresetLines } from "../tools/eslint-preset.ts";
import { makeRepo } from "./temp-repo.ts";

const APP = "apps/web";
const BASE = "@repo/eslint-config";
const CONFIG = 'export default { workspaces: [{ path: "apps/*", shape: "next-modules", next: true }], root: { entries: ["apps", "packages"] } };\n';
const OWN_ESLINT = `import { nextJsConfig } from "${BASE}/next-js";\n\nexport default nextJsConfig;\n`;
const BROUGHT = { "@eslint/js": "^10.0.0", "eslint-config-prettier": "^10.1.1", "typescript-eslint": "^9.0.0" };

/** A copy of a tool that says where it was loaded from, or fails to load as a version that refuses the project's TypeScript does. */
function install(root: string, folder: string, name: string, source: string): void {
  const dir = path.join(root, folder, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "9.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(dir, "index.js"), source);
}

/** A create-turbo app as pnpm installs it: the app lists ESLint only, and typescript-eslint sits inside the config package. */
function project(eslintConfig = OWN_ESLINT) {
  const repo = makeRepo({
    "harness.config.ts": CONFIG,
    ".gitignore": "node_modules\n",
    "package.json": "{}\n",
    [`${APP}/package.json`]: JSON.stringify({ name: "web", devDependencies: { eslint: "^10.9.1", [BASE]: "workspace:*" } }),
    [`${APP}/eslint.config.js`]: eslintConfig,
    [`${APP}/app/page.tsx`]: "export default function Page() {\n  return null;\n}\n",
    "packages/eslint-config/package.json": JSON.stringify({ name: BASE, exports: { "./next-js": "./next.js" }, devDependencies: BROUGHT }),
    "packages/eslint-config/next.js": "export const nextJsConfig = [];\n",
  });
  const scope = path.join(repo.root, APP, "node_modules/@repo");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(path.join(repo.root, "packages/eslint-config"), path.join(scope, "eslint-config"), "dir");
  return { ...repo, dir: path.join(repo.root, APP) };
}

describe("tools the project's own lint config already brings", () => {
  // A name no real package has: under a package manager, NODE_PATH would resolve a real tool from this repository.
  const TOOL = "harness-fixture-tool";

  it("are loaded from the base package when the workspace installs none, and from the workspace when it does", () => {
    const repo = project();
    install(repo.root, "packages/eslint-config", TOOL, 'module.exports = { from: "the base package" };\n');
    expect(() => toolLoader(repo.dir)(TOOL)).toThrow(`The harness preset cannot load ${TOOL} from ${repo.dir}; install it`);
    expect(toolLoader(repo.dir, BASE)(TOOL)).toEqual({ from: "the base package" });
    expect(() => toolLoader(repo.dir, BASE)("harness-fixture-absent")).toThrow(`from ${repo.dir} or from ${BASE}`);
    install(repo.root, APP, TOOL, 'module.exports = { from: "the workspace" };\n');
    expect(toolLoader(repo.dir, BASE)(TOOL)).toEqual({ from: "the workspace" });
  });

  it("report a workspace copy that fails to load instead of passing it over", () => {
    const repo = project();
    install(repo.root, "packages/eslint-config", TOOL, 'module.exports = { from: "the base package" };\n');
    install(repo.root, APP, TOOL, 'throw new Error("typescript-eslint does not support TS 7.0.");\n');
    expect(() => toolLoader(repo.dir, BASE)(TOOL)).toThrow("typescript-eslint does not support TS 7.0.");
  });

  it("are named to the preset in the printed lines and left out of the install line", () => {
    const repo = project();
    const [workspace] = expandWorkspaces(repo.root, loadConfig(repo.root));
    if (workspace === undefined) throw new Error("no workspace");
    expect(eslintPresetLines(workspace, OWN_ESLINT, repo.dir)[1]).toBe(
      `export default [...[nextJsConfig].flat(), ...harnessEslint({ root: import.meta.dirname, layout: "app-root", base: false, toolsFrom: "${BASE}" })];`,
    );
    const line = peerInstall(repo.root, loadConfig(repo.root), workspace) ?? "";
    expect(line).toContain(`cd ${APP} && pnpm add -D `);
    expect(line).toContain(" prettier@");
    for (const name of Object.keys(BROUGHT)) expect(line, name).not.toContain(` ${name}@`);

    const plain = project("export default [];\n");
    const [alone] = expandWorkspaces(plain.root, loadConfig(plain.root));
    if (alone === undefined) throw new Error("no workspace");
    expect(eslintPresetLines(alone, "export default [];\n", plain.dir)[1]).toBe(
      '...harnessEslint({ root: import.meta.dirname, layout: "app-root", next: true }),',
    );
    expect(peerInstall(plain.root, loadConfig(plain.root), alone)).toContain(" typescript-eslint@");
  });

  it("do not count what a registry package only develops with: its devDependencies are never installed", () => {
    const plugin = 'import playwright from "eslint-plugin-playwright";\n\nexport default [playwright];\n';
    const repo = project(plugin);
    const dir = path.join(repo.dir, "node_modules/eslint-plugin-playwright");
    fs.mkdirSync(dir, { recursive: true });
    const manifest = (groups: object): void =>
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "eslint-plugin-playwright", ...groups }));
    const [workspace] = expandWorkspaces(repo.root, loadConfig(repo.root));
    if (workspace === undefined) throw new Error("no workspace");
    manifest({ devDependencies: { "typescript-eslint": "^8.0.0" } });
    expect(eslintPresetLines(workspace, plugin, repo.dir)[1]).toBe('...harnessEslint({ root: import.meta.dirname, layout: "app-root", next: true }),');
    expect(peerInstall(repo.root, loadConfig(repo.root), workspace)).toContain(" typescript-eslint@");
    manifest({ dependencies: { "typescript-eslint": "^8.0.0" } });
    expect(eslintPresetLines(workspace, plugin, repo.dir)[1]).toContain('base: false, toolsFrom: "eslint-plugin-playwright"');
    manifest({ peerDependencies: { "typescript-eslint": "^8.0.0" } });
    expect(eslintPresetLines(workspace, plugin, repo.dir)[1]).toContain("base: false");
  });

  it("leave create-next-app's own config as it was: it names its base itself", () => {
    const own = 'import nextTs from "eslint-config-next/typescript";\n\nexport default [...nextTs];\n';
    const repo = project(own);
    const dir = path.join(repo.dir, "node_modules/eslint-config-next");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "eslint-config-next", dependencies: { "typescript-eslint": "^8.0.0" } }));
    const [workspace] = expandWorkspaces(repo.root, loadConfig(repo.root));
    if (workspace === undefined) throw new Error("no workspace");
    expect(eslintPresetLines(workspace, own, repo.dir)[1]).toBe('...harnessEslint({ root: import.meta.dirname, layout: "app-root", base: false }),');
    expect(peerInstall(repo.root, loadConfig(repo.root), workspace)).toContain(" typescript-eslint@");
  });
});
