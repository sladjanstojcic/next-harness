import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

export interface WorkspaceConfig {
  path: string;
  shape: "next-modules";
  tools?: "eslint-prettier";
  next?: boolean;
}

export interface HarnessConfig {
  workspaces: WorkspaceConfig[];
  owned?: string[];
  locked?: string[];
  legacy?: string;
  root?: { entries?: string[]; jsExceptions?: string[] };
}

export interface WorkspaceEntry {
  path: string;
  shape: WorkspaceConfig["shape"];
  tools: "eslint-prettier";
  next: boolean;
}

export const CONFIG_FILE = "harness.config.ts";

export const DEFAULT_CONFIG: HarnessConfig = {
  workspaces: [{ path: ".", shape: "next-modules", tools: "eslint-prettier", next: true }],
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
      z.strictObject({
        path: workspacePath,
        shape: z.literal("next-modules"),
        tools: z.literal("eslint-prettier").exactOptional(),
        next: z.boolean().exactOptional(),
      }),
    )
    .min(1),
  owned: z.array(z.string().min(1)).exactOptional(),
  locked: z.array(z.string().min(1)).exactOptional(),
  legacy: z.string().min(1).exactOptional(),
  root: z.strictObject({ entries: z.array(z.string().min(1)).exactOptional(), jsExceptions: z.array(z.string().min(1)).exactOptional() }).exactOptional(),
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

export function expandWorkspaces(gitRoot: string, config: HarnessConfig): WorkspaceEntry[] {
  return config.workspaces.flatMap((workspace) => {
    const normalised = normalise(workspace.path);
    const paths = normalised.endsWith("/*") ? directories(gitRoot, normalised.slice(0, -2)) : [normalised];
    return paths.map((workspacePath) => ({
      path: workspacePath,
      shape: workspace.shape,
      tools: workspace.tools ?? "eslint-prettier",
      next: workspace.next ?? false,
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
