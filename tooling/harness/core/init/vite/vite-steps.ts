import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../../../config.ts";
import { presetImport } from "../../../tools/eslint-preset.ts";
import { compilerOptionsInForce, tsconfigFiles, typecheckProjects } from "../../../tools/typescript.ts";
import { managerCommands } from "../bootstrap.ts";

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
  const oxlint = fs.existsSync(path.join(dir, ".oxlintrc.json"))
    ? [`Remove the template's oxlint, which the ESLint preset replaces: delete ${label(".oxlintrc.json")} and run ${removeOxlint}`]
    : [];
  const sources = path.join(dir, "src") + path.sep;
  const app = projects.find((project) => tsconfigFiles(path.join(dir, project)).some((file) => file.startsWith(sources)));
  const mapped = app === undefined || compilerOptionsInForce(path.join(dir, app))?.paths?.["@/*"] !== undefined;
  // Vite's own resolver follows the solution tsconfig's references to the project that holds the alias.
  const alias = mapped
    ? []
    : [
        `Map @/ to src/ (init does not edit these files): add "paths": { "@/*": ["./src/*"] } to compilerOptions of ${label(app)}, and resolve: { tsconfigPaths: true } to ${label(VITE_CONFIG)}`,
      ];
  return [...strict, ...oxlint, ...alias];
}

/** The hand steps of every vite-spa workspace, for init's numbered list. */
export function viteTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "vite-spa").flatMap((workspace) => workspaceTodo(root, workspace));
}
