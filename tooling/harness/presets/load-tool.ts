import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The real folder of a package the workspace can import, from the nearest node_modules up the tree; undefined when it is not installed. */
function packageFolder(root: string, name: string): string | undefined {
  for (let current = path.resolve(root); ; current = path.dirname(current)) {
    const folder = path.join(current, "node_modules", name);
    if (fs.existsSync(path.join(folder, "package.json"))) return fs.realpathSync(folder);
    if (current === path.dirname(current)) return undefined;
  }
}

/**
 * TypeScript 7 ships no JavaScript API, which typescript-eslint needs. TypeScript 6 installed under the name `typescript`
 * gives it one; that package's binary is `tsc6`, so `tsc` stays the project's own.
 */
export const TYPESCRIPT_API = "typescript@npm:@typescript/typescript6@^6.0.2";
export const TYPESCRIPT_API_REASON =
  "typescript-eslint needs TypeScript's JavaScript API and TypeScript 7 has none, so the alias installs TypeScript 6 under the name typescript, while `tsc` stays the project's own";

/** Whether the `typescript` a folder resolves is 7 or newer. */
export function lacksTypescriptApi(root: string): boolean {
  const folder = packageFolder(root, "typescript");
  if (folder === undefined) return false;
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8"));
  const version = isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : "";
  return Number(version.split(".")[0]) >= 7;
}

const isMissing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND";

/**
 * Loads tool packages from the workspace that calls a preset. The harness depends on none of them, and in a monorepo they
 * sit in the workspace's node_modules, which an import from the harness folder does not reach. A tool the workspace does
 * not install is then loaded from `from`, the package its own lint config takes its base from: that copy is the one the
 * project already runs, where a second one could be a version its TypeScript refuses.
 */
export function toolLoader(root: string, from?: string): (request: string) => unknown {
  const shared = from === undefined ? undefined : packageFolder(root, from);
  const loaders = [root, ...(shared === undefined ? [] : [shared])].map((folder) => createRequire(path.join(folder, "package.json")));
  return (request) => {
    let first: unknown;
    for (const load of loaders) {
      try {
        const loaded: unknown = load(request);
        return loaded;
      } catch (error) {
        first ??= error;
        if (!isMissing(error)) break;
      }
    }
    const reason = first instanceof Error ? first.message : String(first);
    const where = from === undefined ? root : `${root} or from ${from}`;
    const advice =
      !isMissing(first) && lacksTypescriptApi(root) ? `${TYPESCRIPT_API_REASON}. Add "${TYPESCRIPT_API}" to that workspace` : "install it in that workspace";
    throw new Error(`The harness preset cannot load ${request} from ${where}; ${advice}. ${reason}`, { cause: first });
  };
}

/** A property of a loaded module, or undefined when the value has none; some packages export a function that carries the rest. */
export const member = (value: unknown, key: string): unknown =>
  (typeof value === "object" || typeof value === "function") && value !== null ? Reflect.get(value, key) : undefined;

/** The default export of an ES module or of a transpiled CommonJS one; a plain CommonJS export as it is. */
export const defaultOf = (loaded: unknown): unknown => (isRecord(loaded) && "default" in loaded ? loaded.default : loaded);

export function call(target: unknown, args: unknown[]): unknown {
  if (typeof target !== "function") throw new Error("A tool package the harness preset loaded lacks a function the preset calls.");
  return Reflect.apply(target, undefined, args);
}

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
