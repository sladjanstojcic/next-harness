/** The import aliases an Electron project declares, read once for dependency-cruiser and for the ESLint boundaries. */
import path from "node:path";
import { call, isRecord, member } from "./load-tool.ts";

export interface ElectronAliases {
  /** Prefixes that name src/renderer/src/, such as "@/" and "@renderer/". */
  renderer: string[];
  /** Prefixes that name src/shared/, such as "@shared/". */
  contract: string[];
  /** Every `paths` entry in force, its targets as absolute paths. */
  paths: Record<string, string[]>;
}

export const DEFAULT_ALIASES: ElectronAliases = { renderer: ["@/"], contract: ["@shared/"], paths: {} };

interface Parsed {
  paths: Record<string, string[]>;
  references: string[];
}

/** One tsconfig with what it extends: its `paths` as absolute targets, and the tsconfig files it refers to. */
function parse(ts: unknown, file: string): Parsed {
  const sys = member(ts, "sys");
  const host = { ...(isRecord(sys) ? sys : {}), readDirectory: () => [], onUnRecoverableConfigFileDiagnostic: () => undefined };
  const parsed = call(member(ts, "getParsedCommandLineOfConfigFile"), [file, {}, host]);
  const options = member(parsed, "options");
  const base = member(options, "baseUrl") ?? member(options, "pathsBasePath") ?? path.dirname(file);
  const declared = member(options, "paths");
  const paths: Record<string, string[]> = {};
  for (const [alias, targets] of Object.entries(isRecord(declared) ? declared : {})) {
    paths[alias] = (Array.isArray(targets) ? targets : []).map((target) => path.resolve(String(base), String(target)));
  }
  const listed = member(parsed, "projectReferences");
  const references = (Array.isArray(listed) ? listed : []).map((reference) => String(call(member(ts, "resolveProjectReferencePath"), [reference])));
  return { paths, references };
}

/**
 * The aliases of the workspace in `dir`: the union of `paths` in tsconfig.json and in every project it refers to, since a
 * solution-style tsconfig.json often names none itself. `ts` is the TypeScript module of whoever calls: the gate's own, or
 * the workspace's for the ESLint preset. Without a readable tsconfig the layout's own two aliases stand.
 */
export function electronAliases(ts: unknown, dir: string): ElectronAliases {
  let configs: Parsed[];
  try {
    const root = parse(ts, path.join(dir, "tsconfig.json"));
    configs = [root, ...root.references.map((file) => parse(ts, file))];
  } catch {
    return DEFAULT_ALIASES;
  }
  const paths: Record<string, string[]> = {};
  for (const config of configs) for (const [alias, targets] of Object.entries(config.paths)) paths[alias] = [...new Set([...(paths[alias] ?? []), ...targets])];
  /** The prefixes of the `<prefix>*` aliases whose target is `<folder>/*`. */
  const into = (folder: string): string[] =>
    Object.entries(paths)
      .filter(([alias, targets]) => alias.endsWith("/*") && targets.includes(path.join(dir, folder, "*")))
      .map(([alias]) => alias.slice(0, -1))
      .sort();
  const [renderer, contract] = [into("src/renderer/src"), into("src/shared")];
  return { renderer: renderer.length > 0 ? renderer : DEFAULT_ALIASES.renderer, contract: contract.length > 0 ? contract : DEFAULT_ALIASES.contract, paths };
}
