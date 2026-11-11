import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  expandWorkspaces,
  loadConfig,
  sourceRootOf,
  workspaceOf,
  type HarnessConfig,
  type SourceRoot,
  type WorkspaceEntry,
} from "../config.ts";
import { shapeOf } from "../shapes/index.ts";
import { deny, KEBAB, matchesEntry, nameDenial, type PathVerdict, type Shape } from "../shapes/shape.ts";
import { readUpstream } from "./upstream.ts";
import { ROOT_KEBAB_FOLDERS, rootEntries, type RootLayout } from "./root-layout.ts";

const CONFIGURED_JS_ADVICE =
  "Use TypeScript (.ts/.tsx); a tool config that cannot be TypeScript needs an explicit JS_EXCEPTIONS entry, root.jsExceptions in harness.config.ts, or the workspace shape's jsExceptions.";

type HarnessWorkspace = WorkspaceEntry & { shapeImpl: Shape };

export interface Harness {
  config: HarnessConfig;
  configured: boolean;
  root: RootLayout;
  workspaces: HarnessWorkspace[];
  /** The kit's files from the config's upstream list; undefined without one. */
  upstream?: ReadonlySet<string>;
}

function build(gitRoot: string, config: HarnessConfig, hasConfigFile: boolean, files: readonly string[] = []): Harness {
  const upstream = readUpstream(gitRoot, config);
  return {
    ...(upstream === undefined ? {} : { upstream }),
    config,
    configured: hasConfigFile,
    root: rootEntries(config, hasConfigFile),
    workspaces: expandWorkspaces(gitRoot, config, files).map((workspace) => ({ ...workspace, shapeImpl: shapeOf(workspace.shape, sourceRootOf(workspace)) })),
  };
}

const DEFAULT_HARNESS: Harness = build("", DEFAULT_CONFIG, false);

/** `files` are paths about to be written: one that starts a new folder under a `/*` workspace belongs to that workspace. */
export function resolveHarness(gitRoot: string, files: readonly string[] = []): Harness {
  return build(gitRoot, loadConfig(gitRoot), fs.existsSync(path.join(gitRoot, CONFIG_FILE)), files);
}

/** The source root of the workspace holding `file`, for messages that name where code belongs. */
export function sourceRootAt(harness: Harness, file: string): SourceRoot {
  return sourceRootOf(workspaceOf(harness.workspaces, file)?.entry);
}

export function isVendoredIn(harness: Harness, file: string): boolean {
  const found = workspaceOf(harness.workspaces, file);
  return found !== undefined && matchesEntry(found.entry.shapeImpl.vendored, found.path);
}

interface Scope {
  path: string;
  entries: ReadonlySet<string>;
  folders: ReadonlySet<string>;
  kebabFolders: readonly string[];
  shape?: Shape;
}

function scopeOf(file: string, harness: Harness): Scope {
  const { root } = harness;
  const found = workspaceOf(harness.workspaces, file);
  if (found === undefined) return { path: file, entries: root.entries, folders: root.folders, kebabFolders: ROOT_KEBAB_FOLDERS };
  const shape = found.entry.shapeImpl;
  if (found.entry.path !== "") {
    return { path: found.path, entries: new Set(shape.topEntries), folders: new Set(shape.topFolders), kebabFolders: shape.kebabFolders, shape };
  }
  return {
    path: file,
    entries: new Set([...root.entries, ...shape.topEntries]),
    folders: new Set([...root.folders, ...shape.topFolders]),
    kebabFolders: [...ROOT_KEBAB_FOLDERS, ...shape.kebabFolders],
    shape,
  };
}

export function checkPath(file: string, harness: Harness = DEFAULT_HARNESS): PathVerdict {
  const scope = scopeOf(file, harness);
  const parts = scope.path.split("/");
  const top = parts[0] ?? "";
  const name = parts.at(-1) ?? "";
  const patternEntry = parts.length === 1 && scope.shape?.topEntryPattern?.test(top) === true;
  if ((!scope.entries.has(top) && !patternEntry) || (parts.length > 1 && !scope.folders.has(top))) {
    return deny(
      "unknown-root",
      scope.shape?.topAdvice ?? "Use an approved root entry: application code belongs in src/, harness code in tooling/, and automation in scripts/.",
    );
  }
  const shape = scope.shape?.topEntries.includes(top) ? scope.shape : undefined;
  const hidden = shape?.checkHidden(scope.path);
  if (hidden && !hidden.ok) return hidden;
  if (/\.(?:js|mjs|cjs|jsx)$/i.test(name) && !harness.root.jsExceptions.has(file) && !scope.shape?.jsExceptions.includes(scope.path)) {
    const sources = scope.shape?.sourceRoot === "" ? "app/, modules/, shared/" : "src/";
    const advice = harness.configured
      ? CONFIGURED_JS_ADVICE
      : `Use TypeScript (.ts/.tsx) in ${sources}, tooling/ or scripts/; unsupported tool configs need an explicit JS_EXCEPTIONS entry.`;
    return deny("js-file", scope.shape?.jsAdvice ?? advice);
  }
  if (scope.kebabFolders.includes(top)) {
    for (const [index, part] of parts.entries()) {
      if (scope.entries.has(part) || shape?.isNameExempt(parts, index)) continue;
      if (KEBAB.test(part.split(".")[0] ?? "")) continue;
      const advice = scope.shape?.nameAdvice;
      return advice === undefined ? nameDenial(scope.shape?.sourceRoot) : deny("file-name", advice);
    }
  }
  return shape ? shape.checkPath(scope.path) : { ok: true };
}
