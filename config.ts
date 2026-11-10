import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const SHAPE_NAMES = ["next-modules", "makerkit-app", "makerkit-feature", "supabase"] as const;
const TOOL_SET_NAMES = ["eslint-prettier", "oxc", "none"] as const;
const ANALYSIS_NAMES = ["depcruise", "knip", "jscpd"] as const;

export type ShapeName = (typeof SHAPE_NAMES)[number];
export type ToolSetName = (typeof TOOL_SET_NAMES)[number];
export type AnalysisName = (typeof ANALYSIS_NAMES)[number];

const DEFAULT_TOOLS: Record<ShapeName, ToolSetName> = {
  "next-modules": "eslint-prettier",
  "makerkit-app": "oxc",
  "makerkit-feature": "oxc",
  supabase: "none",
};

export interface WorkspaceConfig {
  path: string;
  shape: ShapeName;
  tools?: ToolSetName;
  next?: boolean;
  /** A package script that runs the workspace's own tests; the gates run it instead of Vitest. */
  test?: string;
}

export interface HarnessConfig {
  workspaces: WorkspaceConfig[];
  owned?: string[];
  locked?: string[];
  legacy?: string;
  /** A list of the kit's files; with it, every file not listed is the project's own. */
  upstream?: string;
  root?: { entries?: string[]; jsExceptions?: string[] };
  env?: "all" | "local";
  analysis?: AnalysisName[];
}

export interface WorkspaceEntry {
  path: string;
  shape: ShapeName;
  tools: ToolSetName;
  next: boolean;
  test?: string;
}

export const CONFIG_FILE = "harness.config.ts";

export const DEFAULT_CONFIG: HarnessConfig = {
  workspaces: [{ path: ".", shape: "next-modules", tools: "eslint-prettier", next: true }],
  analysis: ["depcruise", "knip", "jscpd"],
};

export function defineHarness(config: HarnessConfig): HarnessConfig {
  return config;
}

function normalise(workspace: string): string {
  const normalised = path.posix
    .normalize(workspace)
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
  return normalised === "." ? "" : normalised;
}

const workspacePath = z
  .string()
  .min(1)
  .refine((value) => !path.posix.isAbsolute(value) && !/^\.\.(?:\/|$)/.test(path.posix.normalize(value)), "must stay inside the repository")
  .refine((value) => !normalise(value).replace(/\/\*$/, "").includes("*"), 'may use "*" only as a final "/*"');

const schema = z.strictObject({
  workspaces: z
    .array(
      z
        .strictObject({
          path: workspacePath,
          shape: z.enum(SHAPE_NAMES),
          tools: z.enum(TOOL_SET_NAMES).exactOptional(),
          next: z.boolean().exactOptional(),
          test: z.string().min(1).exactOptional(),
        })
        .refine((workspace) => workspace.shape !== "supabase" || (workspace.tools ?? "none") === "none", {
          path: ["tools"],
          message: 'must be "none" for the supabase shape',
        })
        .refine((workspace) => workspace.test === undefined || (workspace.tools ?? DEFAULT_TOOLS[workspace.shape]) !== "none", {
          path: ["test"],
          message: 'needs a tool set; a workspace with tools: "none" runs no steps',
        }),
    )
    .min(1),
  owned: z.array(z.string().min(1)).exactOptional(),
  locked: z.array(z.string().min(1)).exactOptional(),
  legacy: z.string().min(1).exactOptional(),
  upstream: z.string().min(1).exactOptional(),
  root: z.strictObject({ entries: z.array(z.string().min(1)).exactOptional(), jsExceptions: z.array(z.string().min(1)).exactOptional() }).exactOptional(),
  env: z.enum(["all", "local"]).exactOptional(),
  analysis: z.array(z.enum(ANALYSIS_NAMES)).exactOptional(),
});

export function loadConfig(gitRoot: string): HarnessConfig {
  const file = path.join(gitRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  let exported: unknown;
  try {
    exported = createRequire(file)(file);
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (typeof exported === "object" && exported !== null && "default" in exported) exported = exported.default;
  else if (Object.prototype.toString.call(exported) === "[object Module]") throw new Error(`${CONFIG_FILE}: default export is missing`);
  const result = schema.safeParse(exported);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(`${CONFIG_FILE}: ${issue?.path.map(String).join(".") || "default export"} ${issue?.message ?? "is invalid"}`);
}

function directories(gitRoot: string, parent: string): string[] {
  const dir = path.join(gitRoot, parent);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith("."))
    .map((item) => (parent === "" ? item.name : `${parent}/${item.name}`))
    .sort();
}

export const toolsOf = (workspace: WorkspaceConfig): ToolSetName => workspace.tools ?? DEFAULT_TOOLS[workspace.shape];

/** Whether a git-root-relative folder is one of the workspace's folders, without listing the disk. */
export function isWorkspaceFolder(workspace: WorkspaceConfig, folder: string): boolean {
  const normalised = normalise(workspace.path);
  if (!normalised.endsWith("/*")) return folder === normalised;
  const parent = normalised.slice(0, -2);
  const rest = parent === "" ? folder : folder.startsWith(`${parent}/`) ? folder.slice(parent.length + 1) : "";
  return rest !== "" && !rest.includes("/") && !rest.startsWith(".");
}

/** A `/*` workspace covers the folders on disk, plus the folder of each of `files`: a file about to start a new package. */
export function expandWorkspaces(gitRoot: string, config: HarnessConfig, files: readonly string[] = []): WorkspaceEntry[] {
  return config.workspaces.flatMap((workspace) => {
    const normalised = normalise(workspace.path);
    const depth = normalised.split("/").length;
    const starting = files
      .map((file) => file.split("/"))
      .filter((parts) => parts.length > depth)
      .map((parts) => parts.slice(0, depth).join("/"))
      .filter((folder) => isWorkspaceFolder(workspace, folder));
    const paths = normalised.endsWith("/*") ? [...new Set([...directories(gitRoot, normalised.slice(0, -2)), ...starting])] : [normalised];
    return paths.map((workspacePath) => ({
      path: workspacePath,
      shape: workspace.shape,
      tools: toolsOf(workspace),
      next: workspace.next ?? false,
      ...(workspace.test === undefined ? {} : { test: workspace.test }),
    }));
  });
}

export function workspaceOf<T extends WorkspaceEntry>(entries: readonly T[], file: string): { entry: T; path: string } | undefined {
  let match: T | undefined;
  for (const entry of entries) {
    const contains = entry.path === "" || file === entry.path || file.startsWith(`${entry.path}/`);
    if (contains && (match === undefined || entry.path.length > match.path.length)) match = entry;
  }
  if (match === undefined) return undefined;
  return { entry: match, path: match.path === "" ? file : file.slice(match.path.length + 1) };
}

/** depcruise, knip and jscpd run in next-modules workspaces only; the Makerkit and supabase shapes do not install them. */
export function analysisOf(config: HarnessConfig, entry: WorkspaceEntry): AnalysisName[] {
  return entry.shape === "next-modules" ? (config.analysis ?? [...ANALYSIS_NAMES]) : [];
}
