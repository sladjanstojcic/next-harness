import fs from "node:fs";
import { dirname, join } from "node:path";
import type ts from "typescript";
import { MAX_FILE_LINES, MAX_FOLDER_FILES, MAX_PAGE_LINES } from "./limits.ts";

export type PathRule =
  "unknown-root" | "src-shape" | "app-file" | "module-shape" | "shared-shape" | "nesting" | "generic-folder" | "file-name" | "js-file" | "hidden-file";
export type PathVerdict = { ok: true } | { ok: false; rule: PathRule; reason: string };

export interface Shape {
  name: string;
  topEntries: readonly string[];
  /** Top-level file names the shape accepts beyond topEntries, such as README-<topic>.md. */
  topEntryPattern?: RegExp;
  topFolders: readonly string[];
  /** Where the shape keeps application code: absent means src/, "" the workspace top. Messages outside the shape name paths with it. */
  sourceRoot?: string;
  /** The reason for an entry the workspace top does not take, and for a JavaScript file, in this shape's words; the core's own otherwise. */
  topAdvice?: string;
  jsAdvice?: string;
  /** The reason for a name that is not kebab-case in tooling/ or scripts/ of a repository this shape sits at the root of; the core's own otherwise. */
  nameAdvice?: string;
  /** The folder that holds modules/ and shared/ where it is not the source root; messages about shared code name it. */
  moduleRoot?: string;
  kebabFolders: readonly string[];
  checkHidden(path: string): PathVerdict;
  isNameExempt(parts: readonly string[], index: number): boolean;
  checkPath(path: string): PathVerdict;
  vendored: readonly string[];
  /** Generated files matched by name rather than by path, such as a backend's database types; tested beside `vendored`. */
  vendoredPattern?: RegExp;
  jsExceptions: readonly string[];
  routeRoot?: string;
  limits: { fileLines: number; folderFiles: number; pageLines: number };
  folderGuidance(folder: string): string;
  sameNameScope(path: string): string | undefined;
  content: ContentProfile;
  codeIndex(workspaceDir: string): string[];
  /** The line under a failed CI step whose findings all sit in this shape. */
  ciAdvice?: string;
}

/** A colocated test, which sits beside the file it tests and counts towards no folder's size. */
export const TEST_FILE = /\.test\.tsx?$/;
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

/** Hidden files below the given top folders are denied; only .gitkeep may keep an empty folder. */
export function onlyGitkeepHidden(folders: readonly string[], reason: (top: string) => string): Shape["checkHidden"] {
  return (path) => {
    const [top = "", ...inside] = path.split("/");
    const hidden = folders.includes(top) && inside.some((part) => part.startsWith(".") && part !== ".gitkeep");
    return hidden ? deny("hidden-file", reason(top)) : { ok: true };
  };
}

/** Fields of a shape with no exempt names, generated code, JS configs or same-name scopes, at the default size limits. */
export const PLAIN_SHAPE = {
  kebabFolders: [],
  isNameExempt: () => false,
  vendored: [],
  jsExceptions: [],
  limits: { fileLines: MAX_FILE_LINES, folderFiles: MAX_FOLDER_FILES, pageLines: MAX_PAGE_LINES },
  sameNameScope: () => undefined,
} satisfies Partial<Shape>;

/** A `__tests__/` folder: the name is fine, the place is not; tests sit beside the file they test. */
export function testsFolderDenial(path: string, layout: string): PathVerdict | undefined {
  if (!path.split("/").includes("__tests__")) return undefined;
  return deny("file-name", `Put tests beside the file they test as <name>.test.ts, not in __tests__/, in owned code ${layout}.`);
}

/** `root` is the workspace's source root: "src/", or "" when app/, modules/ and shared/ sit at its top. */
export function nameDenial(root = "src/"): PathVerdict {
  const sources = root === "" ? "app/, modules/, shared/" : root;
  return deny("file-name", `Use kebab-case names in ${sources}, tooling/, scripts/ or e2e/; Next route segments belong only in ${root}app/.`);
}

export function matchesEntry(entries: readonly string[], file: string): boolean {
  return entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

/** A finding of a shape's own rule on one parsed file; the audit adds the file. */
export interface SourceFinding {
  rule: string;
  line: number;
  message: string;
}

export type ContentMessage =
  "serverOnly" | "useServer" | "useClient" | "clientImportsServer" | "indexExports" | "thinPage" | "domainTest" | "envAccess" | "errorText";

/** Workspace-relative patterns the core content rules read; a rule whose pattern is absent is off for the shape. */
export interface ContentProfile {
  actionFile?: RegExp;
  /** The shape holds no Server Actions: every "use server" is misplaced, and that finding stands alone on its file. */
  noActions?: true;
  actionBuilders: readonly string[];
  serverFile?: RegExp;
  clientFile?: RegExp;
  publicIndex?: RegExp;
  actionImport?: RegExp;
  aliases: Readonly<Record<string, string>>;
  envFile?: string;
  envScope?: RegExp;
  envAllowed?: RegExp;
  /** Reads of process.env.NEXT_PUBLIC_* stay allowed everywhere: Next inlines them at build time. */
  publicEnvAllowed?: boolean;
  domainFile?: RegExp;
  errorScope?: RegExp;
  /** The message for lint-disable and @ts- suppression comments; absent leaves them to the linter (ESLint's noInlineConfig). */
  inlineDisable?: string;
  /** The message for a relative import that leaves the workspace folder; absent allows it. */
  packageBoundary?: string;
  /** With packageBoundary: only files under this folder are judged, and their relative imports must also stay under it. */
  sourceRoot?: string;
  /** A backend package may be imported in `allowed` only, of the files in `scope`; absent leaves backend packages unjudged. */
  backend?: { scope: RegExp; allowed: RegExp; message: string };
  /**
   * Rules only this shape has, on the parsed file at a workspace-relative path. The audit hands the compiler in, so a
   * shape loads without it: the hooks resolve shapes on every tool call.
   */
  sourceRules?(path: string, source: ts.SourceFile, compiler: typeof ts): SourceFinding[];
  messages: Record<ContentMessage, string>;
}

/** The file a relative `export * from` names: ./x, ./x.ts, ./x.tsx or ./x/index.ts(x). */
function reexportedFile(file: string, target: string): string | undefined {
  const base = join(dirname(file), target);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function exportsOf(file: string, followStars = true): string[] {
  const source = fs.readFileSync(file, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/\bexport\s+\*\s+(?:as\s+([\w$]+)\s+)?from\s+["'](\.[^"']*)["']/g)) {
    const reexported = match[1] === undefined && followStars ? reexportedFile(file, match[2] ?? "") : undefined;
    if (match[1]) names.add(match[1]);
    for (const name of reexported === undefined ? [] : exportsOf(reexported, false)) names.add(name);
  }
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

/** A code index in the making: `section` adds a titled list of the files' exports, `sources` names a folder's source files without tests. */
export function codeIndexBuilder(workspaceDir: string) {
  const lines: string[] = [];
  const section = (title: string, base: string, files: readonly string[]): void => {
    const found = files.flatMap((file) => exportLine(join(workspaceDir, base), file) ?? []);
    if (found.length > 0) lines.push("", `## ${title}`, "", ...found);
  };
  const sources = (folder: string): string[] =>
    sortedEntries(join(workspaceDir, folder))
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name))
      .map((entry) => entry.name);
  return { lines, section, sources };
}

/** The denials of a shared/ folder in a React app's source; each shape words them with its own paths and layout. */
export interface SharedFolderText {
  shape: string;
  nesting: string;
  generic: PathVerdict;
}

/** A React app's shared/, relative to that folder: generated primitives in ui/, flat lib/ and hooks/, and components/ with one area subfolder. */
export function checkSharedFolder(parts: readonly string[], text: SharedFolderText): PathVerdict {
  const folder = parts[0] ?? "";
  if (folder === "ui" && parts.length >= 2) return { ok: true };
  if (!["components", "lib", "hooks"].includes(folder) || parts.length < 2) return deny("shared-shape", text.shape);
  if (parts.length > (folder === "components" ? 3 : 2)) return deny("nesting", text.nesting);
  return parts.length === 3 && GENERIC_FOLDERS.includes(parts[1] ?? "") ? text.generic : { ok: true };
}
