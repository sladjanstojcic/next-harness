import path from "node:path";
import { CONFIG_FILE, sourceRootOf, type WorkspaceEntry } from "../../config.ts";
import { compilerOptionsInForce, tsconfigFiles, typecheckProjects } from "../../tools/typescript.ts";
import { indentOf, isObject, readJson, writer, type Step } from "./files.ts";

const HARNESS_DIR = "tooling/harness";
/** TypeScript's own exclude when a tsconfig names none; adding an entry must not drop it. */
const DEFAULT_EXCLUDE = ["node_modules"];

const ALIAS = "@/*";

/** The `paths` and `baseUrl` in force for a tsconfig, with every file it extends; none when the chain sets none or cannot be read. */
function inForce(file: string): { paths: Record<string, unknown>; baseUrl?: string } {
  const options = compilerOptionsInForce(file);
  return { paths: options?.paths ?? {}, ...(options?.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }) };
}

/**
 * The thin configs import the presets with `.ts` paths, and the vendored harness is the harness's, not the project's,
 * to type-check: the workspace's tsconfig allows `.ts` imports and excludes the harness, where it sits inside the
 * workspace, and `presetConfigs`, the tool configs that import a preset. `exclude` alone does not stop the compiler at an
 * import, so a config left in the program would pull the harness's sources in under the project's own settings.
 *
 * A next-modules workspace also needs `@/*` on its source root: the content rules read that alias and the starter files
 * import through it. create-turbo's app tsconfig has no `paths`, so the step adds it where the chain maps none.
 */
export function tsconfigStep(root: string, workspace: WorkspaceEntry, force: boolean, presetConfigs: readonly string[]): Step {
  const target = workspace.path === "" ? "tsconfig.json" : `${workspace.path}/tsconfig.json`;
  const file = path.join(root, target);
  const left = [...(workspace.path === "" ? [HARNESS_DIR] : []), ...presetConfigs];
  const sources = workspace.shape === "next-modules" ? path.join(path.dirname(file), sourceRootOf(workspace)) : undefined;
  /** The alias as the tsconfig holds it: on the source root, relative to the folder `paths` resolve against. */
  const aliasFrom = (folder: string): string[] => {
    const relative = path
      .relative(folder, sources ?? folder)
      .split(path.sep)
      .join("/");
    return [`${relative.startsWith("..") ? relative : `./${relative}`}/*`.replace("//", "/")];
  };
  const byHandText = (alias: string[]): string => `\n    "compilerOptions": { "paths": { "${ALIAS}": ${JSON.stringify(alias)} } }`;
  const aliasByHand = sources === undefined ? "" : byHandText(aliasFrom(path.dirname(file)));
  let config: Record<string, unknown> | undefined;
  try {
    config = readJson(file, target);
  } catch {
    const manual = `\n    "compilerOptions": { "allowImportingTsExtensions": true }\n    "exclude": [..., ${left.map((entry) => `"${entry}"`).join(", ")}]`;
    return { target, status: "kept", detail: `has comments or is not plain JSON; set by hand:${manual}${aliasByHand}`, todo: true };
  }
  if (config === undefined) {
    return {
      target,
      status: "kept",
      detail: `none; give the one you add compilerOptions.allowImportingTsExtensions: true and exclude ${left.join(", ")}`,
      todo: true,
    };
  }
  const options = isObject(config.compilerOptions) ? config.compilerOptions : {};
  const changes: string[] = [];
  let next: Record<string, unknown> = config;
  if (options.allowImportingTsExtensions !== true) {
    if (options.allowImportingTsExtensions !== undefined && !force) {
      return { target, status: "conflict", detail: "compilerOptions.allowImportingTsExtensions is false; --force sets it to true" };
    }
    next = { ...next, compilerOptions: { ...options, allowImportingTsExtensions: true } };
    changes.push("compilerOptions.allowImportingTsExtensions: true");
  }
  let hand = "";
  const { paths, baseUrl } = sources === undefined ? { paths: {} } : inForce(file);
  if (sources !== undefined && paths[ALIAS] === undefined) {
    const folder = path.dirname(file);
    if (baseUrl !== undefined && path.relative(folder, baseUrl) !== "") {
      // `paths` resolve against a baseUrl in force, so a value written for the tsconfig's own folder would point elsewhere.
      hand = `; its baseUrl is ${path.relative(folder, baseUrl).split(path.sep).join("/")}, and paths resolve against it, so add this one by hand:${byHandText(aliasFrom(baseUrl))}`;
    } else if (!isObject(options.paths) && Object.keys(paths).length > 0) {
      // `paths` replaces the one a tsconfig extends, so mappings that come from there cannot be kept by writing here.
      hand = `; it extends other paths, so add this one to them by hand:${aliasByHand}`;
    } else {
      const compilerOptions = isObject(next.compilerOptions) ? next.compilerOptions : options;
      const alias = aliasFrom(folder);
      next = { ...next, compilerOptions: { ...compilerOptions, paths: { ...(isObject(options.paths) ? options.paths : {}), [ALIAS]: alias } } };
      changes.push(`compilerOptions.paths "${ALIAS}": ${JSON.stringify(alias)}`);
    }
  }
  const exclude: unknown[] = Array.isArray(config.exclude) ? config.exclude.map((entry: unknown) => entry) : DEFAULT_EXCLUDE;
  const added = left.filter((entry) => !exclude.includes(entry));
  if (added.length > 0) {
    next = { ...next, exclude: [...exclude, ...added] };
    changes.push(`exclude ${added.join(", ")}`);
  }
  if (changes.length === 0) {
    if (hand === "") return { target, status: "unchanged", detail: "allows .ts imports and leaves the harness out" };
    return { target, status: "kept", detail: `allows .ts imports and leaves the harness out${hand}`, todo: true };
  }
  const apply = writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`);
  return { target, status: "updated", detail: `${changes.join(", ")}${hand}`, ...(hand === "" ? {} : { todo: true }), apply };
}

/**
 * A workspace that is type-checked project by project, as an electron-vite one: its tsconfig.json names no file, so the
 * step above has nothing to change there. A project that takes files from the workspace's top (`*.config.ts`) would reach
 * the harness through harness.config.ts and the tool configs that import a preset; nothing imports those files, so leaving
 * them out of that project's `exclude` is enough. That project also takes `scripts/` and `e2e/`, the code beside `src/`.
 * Any other workspace gets the one step above.
 */
export function tsconfigSteps(root: string, workspace: WorkspaceEntry, force: boolean, presetConfigs: readonly string[]): Step[] {
  const dir = path.join(root, workspace.path);
  const projects = typecheckProjects(dir, workspace);
  if (projects.length === 0) return [tsconfigStep(root, workspace, force, presetConfigs)];
  const left = [...(workspace.path === "" ? [HARNESS_DIR, CONFIG_FILE] : []), ...presetConfigs];
  return projects.flatMap((project): Step[] => {
    const file = path.join(dir, project);
    if (!tsconfigFiles(file).some((source) => path.relative(dir, path.dirname(source)) === "")) return [];
    const target = path.posix.join(workspace.path, project);
    const byHand = `"exclude": [..., ${left.map((entry) => `"${entry}"`).join(", ")}]`;
    let config: Record<string, unknown> | undefined;
    try {
      config = readJson(file, target);
    } catch {
      return [{ target, status: "kept", detail: `has comments or is not plain JSON; set by hand:\n    ${byHand}`, todo: true }];
    }
    if (config === undefined) return [];
    const exclude: unknown[] = Array.isArray(config.exclude) ? config.exclude.map((entry: unknown) => entry) : DEFAULT_EXCLUDE;
    const added = left.filter((entry) => !exclude.includes(entry));
    // The same project checks the code beside src/: without these, a first file in scripts/ or e2e/ would need a locked edit.
    const include: unknown[] | undefined = Array.isArray(config.include) ? config.include.map((entry: unknown) => entry) : undefined;
    const wanted = [...(workspace.path === "" ? ["scripts/**/*.ts"] : []), "e2e/**/*.ts"];
    const included = include === undefined ? [] : wanted.filter((entry) => !include.includes(entry));
    if (added.length === 0 && included.length === 0) return [{ target, status: "unchanged", detail: "leaves the harness and its configs out" }];
    const next = {
      ...config,
      ...(include === undefined || included.length === 0 ? {} : { include: [...include, ...included] }),
      ...(added.length === 0 ? {} : { exclude: [...exclude, ...added] }),
    };
    const changes = [...(included.length === 0 ? [] : [`include ${included.join(", ")}`]), ...(added.length === 0 ? [] : [`exclude ${added.join(", ")}`])];
    const apply = writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`);
    return [{ target, status: "updated", detail: changes.join(", "), apply }];
  });
}
