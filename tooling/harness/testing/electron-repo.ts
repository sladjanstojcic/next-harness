import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { initHarness } from "../core/init/init.ts";
import { run } from "./preset-fixture.ts";
import type { RepoFixture } from "./temp-repo.ts";
import { consumerRepo } from "./template-repo.ts";

const template = path.resolve(import.meta.dirname, "../../..");
const fixture = (name: string): Readonly<Record<string, string>> =>
  z.record(z.string(), z.string()).parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")));

/**
 * The official scaffold's files moved into the electron-vite shape, with a small notes feature: aliases declared in the two
 * referenced tsconfig projects only, its own ESLint, Prettier and Vitest configs, and one generated file under shared/ui/.
 */
export const DESK_APP = fixture("desk-app.json");
/**
 * What `pnpm create @quick-start/electron --template react-ts` writes. package.json, the ESLint config, the three
 * tsconfigs, both preload files, electron.vite.config.ts and .prettierrc.yaml are the generator's own text; the other
 * files follow its template around the lines the real output was read for.
 */
export const SCAFFOLD = fixture("electron-vite-scaffold.json");
/**
 * Packages this repository does not install, as node_modules holds them: type and config stubs for Electron, electron-vite
 * and the ESLint plugins, the @electron-toolkit configs as published, and an `electron-vite` binary that only writes out/.
 */
const STUBS = fixture("electron-stubs.json");
/** Packages the template installs as a dependency of another package, which these projects list themselves. */
const TRANSITIVE = ["vite", "globals"];

export const ELECTRON_CONFIG = 'export default {\n  workspaces: [{ path: ".", shape: "electron-vite" }],\n};\n';
export const ELECTRON_LEGACY = "tooling/harness-legacy.json";
export const ELECTRON_LEGACY_CONFIG = `export default {\n  workspaces: [{ path: ".", shape: "electron-vite" }],\n  legacy: "${ELECTRON_LEGACY}",\n};\n`;

const link = (target: string, at: string): void => {
  if (!fs.existsSync(at)) fs.symlinkSync(target, at);
};

/** node_modules as an install leaves it: the template's packages linked one by one, then the stubs written as packages. */
function installModules(repo: RepoFixture): void {
  const installed = path.join(template, "node_modules");
  const modules = path.join(repo.root, "node_modules");
  fs.mkdirSync(path.join(modules, ".bin"), { recursive: true });
  for (const stub of Object.keys(STUBS)) fs.mkdirSync(path.join(modules, path.dirname(stub)), { recursive: true });
  for (const [stub, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(modules, stub), text);
  for (const entry of fs.readdirSync(installed).filter((name) => !name.startsWith("."))) {
    if (!entry.startsWith("@")) link(path.join(installed, entry), path.join(modules, entry));
    else {
      fs.mkdirSync(path.join(modules, entry), { recursive: true });
      for (const scoped of fs.readdirSync(path.join(installed, entry))) link(path.join(installed, entry, scoped), path.join(modules, entry, scoped));
    }
  }
  for (const name of TRANSITIVE) link(path.join(installed, ".pnpm/node_modules", name), path.join(modules, name));
  for (const binary of fs.readdirSync(path.join(installed, ".bin"))) link(path.join(installed, ".bin", binary), path.join(modules, ".bin", binary));
  fs.chmodSync(path.join(modules, "electron-vite/bin.js"), 0o755);
  link("../electron-vite/bin.js", path.join(modules, ".bin/electron-vite"));
  fs.appendFileSync(path.join(repo.root, repo.git("rev-parse", "--git-path", "info/exclude").trim()), "/node_modules\n");
}

/** An Electron project before init, with its dependencies installed and the harness presets as a subtree holds them. */
export function electronProject(files: Readonly<Record<string, string>>, config = ELECTRON_CONFIG): RepoFixture {
  const repo = consumerRepo({ ...files, "harness.config.ts": config }, false);
  installModules(repo);
  return repo;
}

/** What init's install line adds to package.json in a project that lacks them; here node_modules already holds them. */
const TOOLS = { "dependency-cruiser": "18.7.2", jscpd: "5.4.2", knip: "6.44.1", vitest: "5.1.0" };
const manifest = z.looseObject({ devDependencies: z.record(z.string(), z.string()) });

/** A kept ESLint config with the two lines init printed for it: the import first, the spread as the last argument of its exported call. */
function withPresetLines(config: string, report: string): string {
  const lines = report.split("\n").map((line) => line.trim());
  const at = lines.findIndex((line) => line.startsWith("import { harnessEslint }"));
  const [importLine, spread] = at === -1 ? [] : lines.slice(at, at + 2);
  if (importLine === undefined || spread === undefined) throw new Error(`init printed no ESLint lines:\n${report}`);
  const end = config.lastIndexOf(")");
  const before = config.slice(0, end).trimEnd();
  return `${importLine}\n${before}${before.endsWith(",") ? "" : ","}\n  ${spread}\n${config.slice(end)}`;
}

/**
 * That project after init and its printed steps, not yet committed: the tools in package.json, the two lines in the kept
 * ESLint config, and the edited files formatted in the project's own style.
 */
export function adoptedElectron(files: Readonly<Record<string, string>>, config = ELECTRON_CONFIG) {
  const repo = electronProject(files, config);
  const { report, ok } = initHarness(repo.root, { force: false, starter: false });
  expect(ok, report).toBe(true);
  const own = manifest.parse(JSON.parse(repo.read("package.json")));
  repo.write("package.json", `${JSON.stringify({ ...own, devDependencies: { ...TOOLS, ...own.devDependencies } }, null, 2)}\n`);
  const eslint = ["eslint.config.ts", "eslint.config.mjs"].find((name) => fs.existsSync(path.join(repo.root, name))) ?? "";
  repo.write(eslint, withPresetLines(repo.read(eslint), report));
  const format = run(repo.root, "prettier", ["--write", eslint, "package.json"]);
  expect(format.status, format.output).toBe(0);
  return { ...repo, report };
}

export function commitAll(repo: RepoFixture): void {
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "Add the harness");
}
