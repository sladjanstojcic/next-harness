import fs from "node:fs";
import { join } from "node:path";

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
  jsExceptions: readonly string[];
  routeRoot?: string;
  limits: { fileLines: number; folderFiles: number; pageLines: number };
  folderGuidance(folder: string): string;
  sameNameScope(path: string): string | undefined;
  content: ContentProfile;
  codeIndex(workspaceDir: string): string[];
}

export const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ROUTE_SEGMENT = /^(?:\[(?:\.\.\.)?[^.[\]]+\]|\[\[\.\.\.[^.[\]]+\]\]|\([^)]+\)|@[a-zA-Z0-9_-]+)$/;
export const INTERCEPTING_SEGMENT = /^(?:\(\.{1,3}\))+[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Area subfolders are named after their area; these names describe nothing and become junk drawers. */
export const GENERIC_FOLDERS: readonly string[] = ["utils", "helpers", "common", "misc", "shared", "lib", "core", "base", "stuff", "other", "general"];

/** Next.js special and metadata files a route folder may hold; globals.css only at the app root. */
export function isNextSpecialFile(file: string, atAppRoot: boolean): boolean {
  const special = /^(?:page|layout|loading|error|global-error|not-found|template|default|forbidden|unauthorized|global-not-found)\.tsx$/;
  const metadata = /^(?:(?:icon\d*|apple-icon\d*|opengraph-image|twitter-image)\..+|sitemap\.(?:ts|xml)|robots\.(?:ts|txt)|manifest\.(?:ts|json|webmanifest))$/;
  return special.test(file) || metadata.test(file) || file === "route.ts" || file === "favicon.ico" || (file === "globals.css" && atAppRoot);
}

export function deny(rule: PathRule, reason: string): PathVerdict {
  return { ok: false, rule, reason };
}

export function nameDenial(): PathVerdict {
  return deny("file-name", "Use kebab-case names in src/, tooling/, scripts/ or e2e/; Next route segments belong only in src/app/.");
}

export function matchesEntry(entries: readonly string[], file: string): boolean {
  return entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

export type ContentMessage =
  "serverOnly" | "useServer" | "useClient" | "clientImportsServer" | "indexExports" | "thinPage" | "domainTest" | "envAccess" | "errorText";

/** Workspace-relative patterns the core content rules read; a rule whose pattern is absent is off for the shape. */
export interface ContentProfile {
  actionFile?: RegExp;
  actionBuilders: readonly string[];
  serverFile?: RegExp;
  clientFile?: RegExp;
  publicIndex?: RegExp;
  actionImport?: RegExp;
  aliases: Readonly<Record<string, string>>;
  envFile?: string;
  envScope?: RegExp;
  envAllowed?: RegExp;
  domainFile?: RegExp;
  errorScope?: RegExp;
  messages: Record<ContentMessage, string>;
}

function exportsOf(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const entry of (match[1] ?? "").split(",")) {
      const name = entry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (name) names.add(name);
    }
  }
  for (const match of source.matchAll(/\bexport\s+(?:async\s+|abstract\s+)?(?:function|const|let|type|interface|class|enum)\s+([\w$]+)/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

export function sortedEntries(directory: string): fs.Dirent[] {
  return fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : [];
}

/** One code-index line listing a file's named exports, or undefined when the file is absent. */
export function exportLine(base: string, file: string): string | undefined {
  const absolute = join(base, file);
  if (!fs.existsSync(absolute)) return undefined;
  return `- \`${file}\`: ${
    exportsOf(absolute)
      .map((name) => `\`${name}\``)
      .join(", ") || "(no named exports)"
  }`;
}
