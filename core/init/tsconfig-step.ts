import path from "node:path";
import type { WorkspaceEntry } from "../../config.ts";
import { indentOf, isObject, readJson, writer, type Step } from "./files.ts";

const HARNESS_DIR = "tooling/harness";
/** TypeScript's own exclude when a tsconfig names none; adding an entry must not drop it. */
const DEFAULT_EXCLUDE = ["node_modules"];

/**
 * The thin configs import the presets with `.ts` paths, and the vendored harness is the harness's, not the project's,
 * to type-check: the workspace's tsconfig allows `.ts` imports and excludes the harness, where it sits inside the
 * workspace, and `presetConfigs`, the tool configs that import a preset. `exclude` alone does not stop the compiler at an
 * import, so a config left in the program would pull the harness's sources in under the project's own settings.
 */
export function tsconfigStep(root: string, workspace: WorkspaceEntry, force: boolean, presetConfigs: readonly string[]): Step {
  const target = workspace.path === "" ? "tsconfig.json" : `${workspace.path}/tsconfig.json`;
  const file = path.join(root, target);
  const left = [...(workspace.path === "" ? [HARNESS_DIR] : []), ...presetConfigs];
  let config: Record<string, unknown> | undefined;
  try {
    config = readJson(file, target);
  } catch {
    const manual = `\n    "compilerOptions": { "allowImportingTsExtensions": true }\n    "exclude": [..., ${left.map((entry) => `"${entry}"`).join(", ")}]`;
    return { target, status: "kept", detail: `has comments or is not plain JSON; set by hand:${manual}`, todo: true };
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
  const exclude: unknown[] = Array.isArray(config.exclude) ? config.exclude.map((entry: unknown) => entry) : DEFAULT_EXCLUDE;
  const added = left.filter((entry) => !exclude.includes(entry));
  if (added.length > 0) {
    next = { ...next, exclude: [...exclude, ...added] };
    changes.push(`exclude ${added.join(", ")}`);
  }
  if (changes.length === 0) return { target, status: "unchanged", detail: "allows .ts imports and leaves the harness out" };
  return { target, status: "updated", detail: changes.join(", "), apply: writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`) };
}
