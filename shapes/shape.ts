export type PathRule =
  "unknown-root" | "src-shape" | "app-file" | "module-shape" | "shared-shape" | "nesting" | "generic-folder" | "file-name" | "js-file" | "hidden-file";
export type PathVerdict = { ok: true } | { ok: false; rule: PathRule; reason: string };

export interface Shape {
  name: string;
  topEntries: readonly string[];
  topFolders: readonly string[];
  kebabFolders: readonly string[];
  checkHidden(path: string): PathVerdict;
  isNameExempt(parts: readonly string[], index: number): boolean;
  checkPath(path: string): PathVerdict;
  vendored: readonly string[];
  routeRoot?: string;
  limits: { fileLines: number; folderFiles: number; pageLines: number };
  folderGuidance(folder: string): string;
  sameNameScope(path: string): string | undefined;
}

export const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ROUTE_SEGMENT = /^(?:\[(?:\.\.\.)?[^.[\]]+\]|\[\[\.\.\.[^.[\]]+\]\]|\([^)]+\)|@[a-zA-Z0-9_-]+)$/;
export const INTERCEPTING_SEGMENT = /^(?:\(\.{1,3}\))+[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Area subfolders are named after their area; these names describe nothing and become junk drawers. */
export const GENERIC_FOLDERS: readonly string[] = ["utils", "helpers", "common", "misc", "shared", "lib", "core", "base", "stuff", "other", "general"];

export function deny(rule: PathRule, reason: string): PathVerdict {
  return { ok: false, rule, reason };
}

export function nameDenial(): PathVerdict {
  return deny("file-name", "Use kebab-case names in src/, tooling/, scripts/ or e2e/; Next route segments belong only in src/app/.");
}

export function matchesEntry(entries: readonly string[], file: string): boolean {
  return entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}
