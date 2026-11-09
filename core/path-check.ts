import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, DEFAULT_CONFIG, expandWorkspaces, loadConfig, workspaceOf, type HarnessConfig, type WorkspaceEntry } from "../config.ts";
import { shapeOf } from "../shapes/index.ts";
import { deny, KEBAB, matchesEntry, nameDenial, type PathVerdict, type Shape } from "../shapes/shape.ts";
import { ROOT_KEBAB_FOLDERS, rootEntries, type RootLayout } from "./root-layout.ts";

type HarnessWorkspace = WorkspaceEntry & { shapeImpl: Shape };

export interface Harness {
  config: HarnessConfig;
  root: RootLayout;
  workspaces: HarnessWorkspace[];
}

function build(gitRoot: string, config: HarnessConfig, hasConfigFile: boolean): Harness {
  return {
    config,
    root: rootEntries(config, hasConfigFile),
    workspaces: expandWorkspaces(gitRoot, config).map((workspace) => ({ ...workspace, shapeImpl: shapeOf(workspace.shape) })),
  };
}

const DEFAULT_HARNESS: Harness = build("", DEFAULT_CONFIG, false);

export function resolveHarness(gitRoot: string): Harness {
  return build(gitRoot, loadConfig(gitRoot), fs.existsSync(path.join(gitRoot, CONFIG_FILE)));
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
  if (!scope.entries.has(top) || (parts.length > 1 && !scope.folders.has(top))) {
    return deny("unknown-root", "Use an approved root entry: application code belongs in src/, harness code in tooling/, and automation in scripts/.");
  }
  const shape = scope.shape?.topEntries.includes(top) ? scope.shape : undefined;
  const hidden = shape?.checkHidden(scope.path);
  if (hidden && !hidden.ok) return hidden;
  if (/\.(?:js|mjs|cjs|jsx)$/i.test(name) && !harness.root.jsExceptions.has(file) && !scope.shape?.jsExceptions.includes(scope.path)) {
    return deny("js-file", "Use TypeScript (.ts/.tsx) in src/, tooling/ or scripts/; unsupported tool configs need an explicit JS_EXCEPTIONS entry.");
  }
  if (scope.kebabFolders.includes(top)) {
    for (const [index, part] of parts.entries()) {
      if (scope.entries.has(part) || shape?.isNameExempt(parts, index)) continue;
      if (!KEBAB.test(part.split(".")[0] ?? "")) return nameDenial();
    }
  }
  return shape ? shape.checkPath(scope.path) : { ok: true };
}
