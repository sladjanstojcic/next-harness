import fs from "node:fs";
import path from "node:path";
import { makeRepo, type RepoFixture } from "./temp-repo.ts";

const template = path.resolve(import.meta.dirname, "../../..");

/** Template-relative paths of every file under a template folder. */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(path.join(template, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

/** The presets, the harness files they import and the harness's package.json, as a subtree holds them. */
const PRESETS = [
  "tooling/harness/package.json",
  "tooling/harness/shapes/limits.ts",
  "tooling/harness/shapes/tool-config-names.ts",
  "tooling/harness/core/init/bootstrap.ts",
  "tooling/harness/core/init/files.ts",
  ...filesUnder("tooling/harness/presets"),
];

export function templateRepo(files: Record<string, string> = {}) {
  const configs = [
    "package.json",
    "tsconfig.json",
    "eslint.config.ts",
    "prettier.config.ts",
    "src/shared/lib/utils.ts",
    "knip.config.ts",
    "vitest.config.ts",
    ".dependency-cruiser.json",
    ".jscpd.json",
    ".gitignore",
    ...PRESETS,
  ];
  const repo = makeRepo({
    ...Object.fromEntries(configs.map((file) => [file, fs.readFileSync(path.join(template, file), "utf8")])),
    "src/app/page.tsx": "export default function Page() { return <main>Hello</main>; }\n",
    "src/app/layout.tsx": "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
    ...files,
  });
  linkModules(repo);
  return repo;
}

/**
 * Links the template's node_modules. A real checkout holds a folder that `node_modules/` ignores; git sees the link as a
 * file, so the repository's own exclude list names it, or every "differs from HEAD" check would count it.
 */
function linkModules(repo: RepoFixture, folder = ""): void {
  fs.symlinkSync(path.join(template, "node_modules"), path.join(repo.root, folder, "node_modules"), "dir");
  fs.appendFileSync(path.join(repo.root, repo.git("rev-parse", "--git-path", "info/exclude").trim()), `/${path.posix.join(folder, "node_modules")}\n`);
}

/**
 * A project before init: the presets as a subtree holds them, the template's node_modules, no tool configs and no git
 * hooks path. `modules` is the folder that holds node_modules: the root, or a workspace as pnpm installs a monorepo;
 * false leaves the install to the caller.
 */
export function consumerRepo(files: Record<string, string>, modules: string | false = "") {
  const repo = makeRepo({ ...Object.fromEntries(PRESETS.map((file) => [file, fs.readFileSync(path.join(template, file), "utf8")])), ...files });
  repo.git("config", "--unset", "core.hooksPath");
  if (modules !== false) linkModules(repo, modules);
  return repo;
}
