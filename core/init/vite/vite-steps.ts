import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../../../config.ts";
import { presetImport } from "../../../tools/eslint-preset.ts";
import { compilerOptionsInForce, tsconfigFiles, typecheckProjects } from "../../../tools/typescript.ts";
import { managerCommands } from "../bootstrap.ts";
import { isObject, readJson } from "../files.ts";
import { LINT_SCRIPT } from "../wiring.ts";

/** create-vite's TypeScript templates write this name; the harness takes no JavaScript config. */
const VITE_CONFIG = "vite.config.ts";

/** The project's Vite config holds its plugins and aliases, which the tests need too: the preset is merged over it. */
export const viteVitestText = (workspace: WorkspaceEntry): string =>
  [
    'import { mergeConfig } from "vitest/config";',
    `import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";`,
    `import viteConfig from "./${VITE_CONFIG}";`,
    "",
    "export default mergeConfig(viteConfig, harnessVitest());",
    "",
  ].join("\n");

/** Whether a tsconfig is plain JSON, which init could write; create-vite's projects hold comments. */
function plainJson(file: string): boolean {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The hand steps of a vite-spa workspace. create-vite's projects are not strict, which the audit's `tsconfig-strict`
 * requires; its oxlint config would lint beside the preset; and nothing maps `@/`, which the module boundaries read.
 */
function workspaceTodo(root: string, workspace: WorkspaceEntry): string[] {
  const dir = path.join(root, workspace.path);
  const label = (file: string): string => path.posix.join(workspace.path, file);
  const listed = typecheckProjects(dir, workspace);
  const projects = listed.length === 0 ? ["tsconfig.json"] : listed;
  const strict = projects
    .filter((project) => compilerOptionsInForce(path.join(dir, project))?.strict !== true)
    .map((project) => {
      const why = plainJson(path.join(dir, project)) ? "" : ", which has comments";
      return `Turn strict type checking on (init does not edit ${label(project)}${why}): add "strict": true to its compilerOptions`;
    });
  const { remove } = managerCommands(root);
  const removeOxlint = workspace.path === "" ? `${remove} oxlint` : `(cd ${workspace.path} && ${remove} oxlint)`;
  // Init adds a lint script only where none exists, so the template's `oxlint` one would outlive the package.
  const scripts = readJson(path.join(dir, "package.json"), label("package.json"))?.scripts;
  const lintScript = isObject(scripts) && scripts.lint === "oxlint" ? `, set the "lint" script in ${label("package.json")} to ${LINT_SCRIPT},` : "";
  const oxlint = fs.existsSync(path.join(dir, ".oxlintrc.json"))
    ? [`Remove the template's oxlint, which the ESLint preset replaces: delete ${label(".oxlintrc.json")}${lintScript} and run ${removeOxlint}`]
    : [];
  const sources = path.join(dir, "src") + path.sep;
  const app = projects.find((project) => tsconfigFiles(path.join(dir, project)).some((file) => file.startsWith(sources)));
  const maps = (project: string): boolean => compilerOptionsInForce(path.join(dir, project))?.paths?.["@/*"] !== undefined;
  const appUnmapped = app !== undefined && !maps(app);
  // Vite's own resolver follows the solution tsconfig's references to the project that holds the alias; shadcn reads only tsconfig.json.
  const unmapped = [...(appUnmapped ? [app] : []), ...(app === "tsconfig.json" || maps("tsconfig.json") ? [] : ["tsconfig.json"])];
  const resolve = appUnmapped ? `, and resolve: { tsconfigPaths: true } to ${label(VITE_CONFIG)}` : "";
  const alias =
    unmapped.length === 0
      ? []
      : [
          `Map @/ to src/ (init does not edit these files): add "paths": { "@/*": ["./src/*"] } to compilerOptions of ${unmapped.map(label).join(" and ")}${resolve}`,
        ];
  return [...strict, ...oxlint, ...alias];
}

/** The hand steps of every vite-spa workspace, for init's numbered list. */
export function viteTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "vite-spa").flatMap((workspace) => workspaceTodo(root, workspace));
}
