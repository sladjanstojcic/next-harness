import { createRequire } from "node:module";
import path from "node:path";

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Loads tool packages from the workspace that calls a preset. The harness depends on none of them, and in a monorepo they
 * sit in the workspace's node_modules, which an import from the harness folder does not reach.
 */
export function toolLoader(root: string): (request: string) => unknown {
  const load = createRequire(path.join(root, "package.json"));
  return (request) => {
    try {
      const loaded: unknown = load(request);
      return loaded;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`The harness preset cannot load ${request} from ${root}; install it in that workspace. ${reason}`, { cause: error });
    }
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
