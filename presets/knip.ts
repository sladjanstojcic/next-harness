import fs from "node:fs";
import path from "node:path";
import { HARNESS_PACKAGE, harnessIsWorkspace } from "../core/init/bootstrap.ts";
import { TOOL_CONFIG_NAMES } from "../shapes/tool-config-names.ts";

const ENTRY = ["src/shared/lib/env.ts", "src/shared/lib/user-error.ts", "src/shared/lib/format.ts", "src/shared/lib/define-action.ts", "src/shared/lib/log.ts"];
const IGNORE = ["src/shared/ui/**", "src/shared/lib/utils.ts"];
const IGNORE_DEPENDENCIES = [
  "server-only", // Imported by server.ts and server/ files; Vitest aliases it, so it may have no static importer yet.
  "cn", // Used only by the vendored src/shared/lib/utils.ts helper.
  "@base-ui/react", // Used by vendored shadcn primitives.
  "class-variance-authority", // Used by vendored shadcn variants.
  "lucide-react", // Used by vendored shadcn icons.
];
/** Loaded by the harness's ESLint preset from the workspace, with no import knip can see. */
const PRESET_DEPENDENCIES = ["@eslint/js", "eslint-config-next", "eslint-config-prettier", "typescript-eslint"];

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
  return {
    next: true,
    entry: ENTRY.filter(exists),
    ignore: [...IGNORE.filter(exists), ...(harness === "ignore" ? [`${HARNESS_PACKAGE}/**`] : [])],
    ignoreDependencies: [...IGNORE_DEPENDENCIES, ...presetOnly(dir)].filter((name) => packages.has(name)),
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
