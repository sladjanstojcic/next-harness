import path from "node:path";
import type { WorkspaceEntry } from "../../config.ts";
import { indentOf, isObject, readJson, writer, type Step } from "./files.ts";

const HARNESS_DIR = "tooling/harness";
/** TypeScript's own exclude when a tsconfig names none; adding an entry must not drop it. */
const DEFAULT_EXCLUDE = ["node_modules"];
const MANUAL = `\n    "compilerOptions": { "allowImportingTsExtensions": true }\n    "exclude": [..., "${HARNESS_DIR}"]`;

/**
 * The thin configs import the presets with `.ts` paths, and the vendored harness is the harness's, not the project's,
 * to type-check: the workspace's tsconfig allows `.ts` imports and, where the harness sits inside the workspace, excludes it.
 */
export function tsconfigStep(root: string, workspace: WorkspaceEntry, force: boolean): Step {
  const target = workspace.path === "" ? "tsconfig.json" : `${workspace.path}/tsconfig.json`;
  const file = path.join(root, target);
  let config: Record<string, unknown> | undefined;
  try {
    config = readJson(file, target);
  } catch {
    return { target, status: "kept", detail: `has comments or is not plain JSON; set by hand:${MANUAL}` };
  }
  if (config === undefined) {
    return { target, status: "kept", detail: `none; give the one you add compilerOptions.allowImportingTsExtensions: true and exclude ${HARNESS_DIR}` };
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
  if (workspace.path === "" && !exclude.includes(HARNESS_DIR)) {
    next = { ...next, exclude: [...exclude, HARNESS_DIR] };
    changes.push(`exclude ${HARNESS_DIR}`);
  }
  if (changes.length === 0) return { target, status: "unchanged", detail: "allows .ts imports and leaves the harness out" };
  return { target, status: "updated", detail: changes.join(", "), apply: writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`) };
}
