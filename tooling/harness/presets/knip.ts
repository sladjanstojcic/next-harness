import fs from "node:fs";
import path from "node:path";
import { HARNESS_PACKAGE, harnessIsWorkspace } from "../core/init/bootstrap.ts";
import { TOOL_CONFIG_NAMES } from "../shapes/tool-config-names.ts";

/** Under src/, or at the top of a workspace without it; only the paths that exist are listed. */
const inSources = (paths: string[]): string[] => ["src/", ""].flatMap((root) => paths.map((file) => `${root}${file}`));
const ENTRY = inSources(["shared/lib/env.ts", "shared/lib/user-error.ts", "shared/lib/format.ts", "shared/lib/define-action.ts", "shared/lib/log.ts"]);
const IGNORE = inSources(["shared/ui/**", "shared/lib/utils.ts"]);
const IGNORE_DEPENDENCIES = [
  "server-only", // Imported by server.ts and server/ files; Vitest aliases it, so it may have no static importer yet.
  "cn", // Used only by the vendored shared/lib/utils.ts helper.
  "@base-ui/react", // Used by vendored shadcn primitives.
  "class-variance-authority", // Used by vendored shadcn variants.
  "lucide-react", // Used by vendored shadcn icons.
];
/** Loaded by the harness's ESLint preset from the workspace, with no import knip can see. */
const PRESET_DEPENDENCIES = ["@eslint/js", "eslint-config-next", "eslint-config-prettier", "typescript-eslint"];

/** The package that brings each tool whose config or binary init adds to a workspace. */
const CONFIG_PACKAGES: readonly [keyof typeof TOOL_CONFIG_NAMES, string][] = [
  ["eslint", "eslint"],
  ["prettier", "prettier"],
  ["vitest", "vitest"],
  ["knip", "knip"],
  ["playwright", "@playwright/test"],
];
const BINARY_PACKAGES: Readonly<Record<string, string>> = {
  eslint: "eslint",
  prettier: "prettier",
  tsc: "typescript",
  vitest: "vitest",
  depcruise: "dependency-cruiser",
  knip: "knip",
  jscpd: "jscpd",
};

/** Whether a folder above the workspace installs the binary. */
function installedAbove(dir: string, binary: string): boolean {
  for (let current = path.dirname(path.resolve(dir)); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, "node_modules/.bin", binary))) return true;
    if (current === path.dirname(current)) return false;
  }
}

/**
 * A monorepo installs a tool once, at its root. Knip reads a tool's config and binary through the workspace's own
 * package.json, so there it would call the config an unused file and the script's binary unlisted: both are named here.
 */
function installedElsewhere(dir: string, packages: ReadonlySet<string>): { configs: string[]; binaries: string[] } {
  const manifest: unknown = fs.existsSync(path.join(dir, "package.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) : {};
  const scripts = typeof manifest === "object" && manifest !== null && "scripts" in manifest ? manifest.scripts : undefined;
  const commands = typeof scripts === "object" && scripts !== null ? Object.values(scripts).filter((script) => typeof script === "string") : [];
  const configs = (tool: keyof typeof TOOL_CONFIG_NAMES): string[] => TOOL_CONFIG_NAMES[tool].filter((name) => fs.existsSync(path.join(dir, name)));
  return {
    configs: CONFIG_PACKAGES.filter(([, name]) => !packages.has(name)).flatMap(([tool]) => configs(tool)),
    // In a monorepo a script may run any binary a folder above installs (`turbo`, the root's Prettier): none is unlisted.
    // The workspace's own copy is knip's to judge; a listed package can still lack the binary, as TypeScript 6 under
    // the name `typescript` brings `tsc6`, not `tsc`.
    binaries: [...new Set(commands.flatMap((command) => command.split(/[\s;&|]+/)))].filter((binary) => {
      if (!/^[\w@][\w@.-]*$/.test(binary) || !installedAbove(dir, binary)) return false;
      const bins = path.join(dir, "node_modules/.bin");
      const listed = packages.has(BINARY_PACKAGES[binary] ?? "") && !fs.existsSync(bins);
      return !listed && !fs.existsSync(path.join(bins, binary));
    }),
  };
}

const SKIPPED_FOLDERS = ["node_modules", ".next", "dist", "build", "out"];

/** The workspace's source files, without dependencies and build output. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") || SKIPPED_FOLDERS.includes(entry.name) ? [] : sourceFiles(file);
    return /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

/**
 * React and its types where every use is JSX: the automatic runtime needs them and no file imports them, so knip would
 * call them unused. A workspace that imports React anywhere needs no entry, and knip would call one stale.
 */
function jsxRuntime(dir: string): string[] {
  const files = sourceFiles(dir);
  const importsReact = (file: string): boolean => /["']react(?:\/[^"']*)?["']/.test(fs.readFileSync(file, "utf8"));
  return files.some((file) => file.endsWith(".tsx")) && !files.some(importsReact) ? ["react", "@types/react"] : [];
}

/** The preset's packages the workspace's own ESLint config does not import itself; knip would call an ignored used one a stale entry. */
function presetOnly(dir: string): string[] {
  const file = TOOL_CONFIG_NAMES.eslint.find((name) => fs.existsSync(path.join(dir, name)));
  const own = file === undefined ? "" : fs.readFileSync(path.join(dir, file), "utf8");
  return PRESET_DEPENDENCIES.filter((name) => !own.includes(`"${name}`) && !own.includes(`'${name}`));
}

export interface HarnessKnipOptions {
  /** A consumer skips the vendored harness; the harness's own repository analyses it. */
  harness?: "analyse" | "ignore";
}

/** The Knip settings the preset writes; Knip's own types stay with the project that installs it. */
export interface KnipWorkspace {
  next: true;
  entry: string[];
  ignore: string[];
  ignoreDependencies: string[];
  ignoreBinaries?: string[];
}

interface KnipWorkspaces {
  ignoreWorkspaces: string[];
  workspaces: Record<string, KnipWorkspace>;
}

function declared(dir: string): Set<string> {
  const value: unknown = fs.existsSync(path.join(dir, "package.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) : {};
  if (typeof value !== "object" || value === null) return new Set();
  const groups = ["dependencies" in value ? value.dependencies : undefined, "devDependencies" in value ? value.devDependencies : undefined];
  return new Set(groups.flatMap((group) => (typeof group === "object" && group !== null ? Object.keys(group) : [])));
}

/** What both presets read from the workspace's package.json and the folders above it: configs to ignore, and the dependency and binary lists. */
function fromManifest(dir: string): { configs: string[]; lists: { ignoreDependencies: string[]; ignoreBinaries?: string[] } } {
  const packages = declared(dir);
  const { configs, binaries } = installedElsewhere(dir, packages);
  const ignoreDependencies = [...IGNORE_DEPENDENCIES, ...presetOnly(dir), ...jsxRuntime(dir)].filter((name) => packages.has(name));
  return { configs, lists: { ignoreDependencies, ...(binaries.length === 0 ? {} : { ignoreBinaries: binaries }) } };
}

/**
 * Knip for a next-modules workspace, run from its folder: Next entry points, the starter helpers as entries, vendored code
 * ignored. Only paths that exist and dependencies the workspace declares are listed, so knip has no stale entry to hint at.
 */
export function harnessKnipWorkspace({ harness = "ignore" }: HarnessKnipOptions = {}, dir = process.cwd()): KnipWorkspace {
  const exists = (pattern: string) => fs.existsSync(path.join(dir, pattern.replace(/\/\*\*$/, "")));
  const { configs, lists } = fromManifest(dir);
  return {
    next: true,
    entry: ENTRY.filter(exists),
    ignore: [...IGNORE.filter(exists), ...configs, ...(harness === "ignore" ? [`${HARNESS_PACKAGE}/**`] : [])],
    ...lists,
  };
}

/** The thin config's preset: where the harness is a workspace package, knip reads it as one, so the settings go to the root workspace. */
export function harnessKnip(dir = process.cwd()): KnipWorkspace | KnipWorkspaces {
  const workspace = harnessKnipWorkspace({}, dir);
  if (!harnessIsWorkspace(dir)) return workspace;
  return {
    ignoreWorkspaces: [HARNESS_PACKAGE],
    workspaces: { ".": { ...workspace, ignore: workspace.ignore.filter((glob) => !glob.startsWith(HARNESS_PACKAGE)) } },
  };
}

/** What the electron-vite build starts from, and the generated shadcn code beside the renderer's own. */
const ELECTRON_ENTRY = ["electron.vite.config.ts", "src/main/index.ts", "src/preload/index.ts", "src/renderer/index.html", "src/renderer/src/main.tsx"];
const ELECTRON_IGNORE = ["src/renderer/src/shared/ui/**", "src/renderer/src/shared/lib/utils.ts"];

type KnipElectron = Omit<KnipWorkspace, "next">;

/**
 * Knip for an electron-vite workspace, run from its folder: the entries of the three processes and the build config,
 * vendored code ignored. Only paths that exist and dependencies the workspace declares are listed, as in an app.
 */
export function harnessKnipElectron(dir = process.cwd()): KnipElectron | { ignoreWorkspaces: string[]; workspaces: Record<string, KnipElectron> } {
  const exists = (pattern: string) => fs.existsSync(path.join(dir, pattern.replace(/\/\*\*$/, "")));
  const { configs, lists } = fromManifest(dir);
  // harness.config.ts sits at this workspace's top, where an Electron project has no other workspace, and no file imports it.
  const workspace = { entry: ELECTRON_ENTRY.filter(exists), ignore: [...[...ELECTRON_IGNORE, "harness.config.ts"].filter(exists), ...configs], ...lists };
  if (harnessIsWorkspace(dir)) return { ignoreWorkspaces: [HARNESS_PACKAGE], workspaces: { ".": workspace } };
  return { ...workspace, ignore: [...workspace.ignore, `${HARNESS_PACKAGE}/**`] };
}

/** The Knip settings for a package: no Next plugin, and the exports of its entry files are judged too. */
interface KnipPackage {
  entry: string[];
  includeEntryExports: true;
  ignore: string[];
  ignoreDependencies: string[];
  ignoreBinaries?: string[];
}

/** The files a package.json `exports` value points at: a string, or the string leaves of its conditions; patterns are knip's to expand. */
function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value.replace(/^\.\//, "")];
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(exportTargets) : [];
}

/**
 * Knip for a `package` workspace, run from its folder: the entries are the files its package.json `exports` point at,
 * and their exports are reported as well, since a package's public API is where unused code hides. Knip sees this
 * package only; the gate takes out the exports another workspace imports.
 */
export function harnessKnipPackage(dir = process.cwd()): KnipPackage {
  const file = path.join(dir, "package.json");
  const manifest: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const exported = typeof manifest === "object" && manifest !== null && "exports" in manifest ? exportTargets(manifest.exports) : [];
  const { configs, lists } = fromManifest(dir);
  return {
    entry: [...new Set(exported)].filter((target) => target.includes("*") || fs.existsSync(path.join(dir, target))),
    includeEntryExports: true,
    ignore: configs,
    ...lists,
  };
}
