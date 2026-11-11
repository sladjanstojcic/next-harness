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
  const runs = (binary: string): boolean => commands.some((command) => command.split(/[\s;&|]+/).includes(binary));
  const configs = (tool: keyof typeof TOOL_CONFIG_NAMES): string[] => TOOL_CONFIG_NAMES[tool].filter((name) => fs.existsSync(path.join(dir, name)));
  return {
    configs: CONFIG_PACKAGES.filter(([, name]) => !packages.has(name)).flatMap(([tool]) => configs(tool)),
    binaries: Object.keys(BINARY_PACKAGES).filter((binary) => !packages.has(BINARY_PACKAGES[binary] ?? "") && runs(binary) && installedAbove(dir, binary)),
  };
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

/**
 * Knip for a next-modules workspace, run from its folder: Next entry points, the starter helpers as entries, vendored code
 * ignored. Only paths that exist and dependencies the workspace declares are listed, so knip has no stale entry to hint at.
 */
export function harnessKnipWorkspace({ harness = "ignore" }: HarnessKnipOptions = {}, dir = process.cwd()): KnipWorkspace {
  const packages = declared(dir);
  const exists = (pattern: string) => fs.existsSync(path.join(dir, pattern.replace(/\/\*\*$/, "")));
  const { configs, binaries } = installedElsewhere(dir, packages);
  return {
    next: true,
    entry: ENTRY.filter(exists),
    ignore: [...IGNORE.filter(exists), ...configs, ...(harness === "ignore" ? [`${HARNESS_PACKAGE}/**`] : [])],
    ignoreDependencies: [...IGNORE_DEPENDENCIES, ...presetOnly(dir)].filter((name) => packages.has(name)),
    ...(binaries.length === 0 ? {} : { ignoreBinaries: binaries }),
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
