import path from "node:path";
import { sourceRootOf, type WorkspaceEntry } from "../../config.ts";
import { ts } from "../../tools/typescript.ts";
import { indentOf, isObject, readJson, writer, type Step } from "./files.ts";

const HARNESS_DIR = "tooling/harness";
/** TypeScript's own exclude when a tsconfig names none; adding an entry must not drop it. */
const DEFAULT_EXCLUDE = ["node_modules"];

const ALIAS = "@/*";

/** The `paths` in force for a tsconfig, with every file it extends; empty when the chain sets none or cannot be read. */
function pathsInForce(file: string): Record<string, unknown> {
  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
  return parsed?.options.paths ?? {};
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
  const alias = workspace.shape === "next-modules" ? [`./${sourceRootOf(workspace)}*`] : undefined;
  const aliasByHand = alias === undefined ? "" : `\n    "compilerOptions": { "paths": { "${ALIAS}": ${JSON.stringify(alias)} } }`;
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
  const inForce = alias === undefined ? {} : pathsInForce(file);
  let byHand = "";
  if (alias !== undefined && inForce[ALIAS] === undefined) {
    // `paths` replaces the one a tsconfig extends, so mappings that come from there cannot be kept by writing here.
    if (!isObject(options.paths) && Object.keys(inForce).length > 0) byHand = aliasByHand;
    else {
      const compilerOptions = isObject(next.compilerOptions) ? next.compilerOptions : options;
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
  const todo = byHand === "" ? {} : { todo: true };
  const hand = byHand === "" ? "" : `; it extends other paths, so add this one to them by hand:${byHand}`;
  if (changes.length === 0) {
    if (byHand === "") return { target, status: "unchanged", detail: "allows .ts imports and leaves the harness out" };
    return { target, status: "kept", detail: `allows .ts imports and leaves the harness out${hand}`, todo: true };
  }
  return { target, status: "updated", detail: `${changes.join(", ")}${hand}`, ...todo, apply: writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`) };
}
