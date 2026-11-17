import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sourceRootOf, type ShapeName, type WorkspaceEntry } from "../../config.ts";
import { PLAYWRIGHT_OUTPUT } from "../../presets/e2e.ts";
import { GENERATED_TYPE_GLOBS } from "../../shapes/backend-folder.ts";
import { pocketbaseFolders } from "../../shapes/pocketbase/own-tools.ts";
import { TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { writer, type Step } from "./files.ts";

export const IGNORED = [".next/", "test-results/"];
/** The build output of the shapes a bundler builds, electron-vite's and Vite's, and the build info `tsc` writes beside each composite project it checks; a Node service has only the build info. */
export const BUNDLE_IGNORED: Partial<Record<ShapeName, readonly string[]>> = {
  "electron-vite": ["out/", "*.tsbuildinfo"],
  "vite-spa": ["dist/", "*.tsbuildinfo"],
  "node-service": ["*.tsbuildinfo"],
};
/** pnpm links the harness's own dependencies here once it is a workspace package; create-next-app ignores only `/node_modules`. */
const HARNESS_MODULES = "tooling/harness/node_modules/";
/**
 * What the root .gitignore takes whatever the workspaces are: the harness's own packages and, beside a turbo.json,
 * Turborepo's cache and logs, which it writes at the root and in each workspace and a project made by hand does not ignore.
 */
export const rootIgnored = (root: string): string[] => [HARNESS_MODULES, ...(fs.existsSync(path.join(root, "turbo.json")) ? [".turbo/"] : [])];
/** Files the format check must skip: in a pocketbase folder the vendored declarations, the build output and PocketBase's data, in an e2e folder Playwright's output, which a .gitignore above the folder does not hide from Prettier; elsewhere pnpm's own lockfile style, the vendored shadcn primitives, generated database types and the build output. */
export function prettierIgnored(workspace: WorkspaceEntry): string[] {
  if (workspace.shape === "pocketbase") return ["types/pocketbase*.d.ts", "dist", "pb_data"];
  if (workspace.shape === "e2e") return [...PLAYWRIGHT_OUTPUT];
  if (workspace.shape === "electron-vite") return ["pnpm-lock.yaml", "src/renderer/src/shared/ui", "out", "dist"];
  const generated = GENERATED_TYPE_GLOBS.map((glob) => `${sourceRootOf(workspace)}backend/${glob}`);
  if (workspace.shape === "vite-spa") return ["pnpm-lock.yaml", "src/shared/ui", "dist", ...generated];
  if (workspace.shape === "node-service") return ["pnpm-lock.yaml", ...generated];
  return ["pnpm-lock.yaml", `${sourceRootOf(workspace)}shared/ui`, ...generated, ".next"];
}
/**
 * The vendored harness and its locked config. A project's `prettier --write .`, `oxfmt` or `oxlint --fix` would rewrite
 * them in the project's style, which the lock then reports; formatting harness.config.ts is the user's, during an unlock.
 */
const HARNESS_IGNORED = ["tooling/harness", "harness.config.ts"];

/**
 * Appends the entries an ignore file lacks, keeping its lines; `isMissing` decides with the file as it stands. `replacing`
 * names the entry that takes the place of a line an older init wrote, which is rewritten where it stands.
 */
function ignoreFileStep(
  root: string,
  target: string,
  entries: readonly string[],
  isMissing: (entry: string, current: string) => boolean,
  replacing: (line: string, before: string) => string | undefined = () => undefined,
): Step {
  const file = path.join(root, target);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const replaced: string[] = [];
  const current = before
    .split("\n")
    .map((line) => {
      const entry = replacing(line.trim(), before);
      if (entry === undefined) return line;
      replaced.push(`${line.trim()} → ${entry}`);
      return `${entry}${line.endsWith("\r") ? "\r" : ""}`;
    })
    .join("\n");
  const missing = entries.filter((entry) => isMissing(entry, current));
  if (missing.length === 0 && replaced.length === 0) return { target, status: "unchanged", detail: entries.join(", ") };
  const appended = missing.length === 0 ? "" : `${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`;
  return { target, status: before === "" ? "created" : "updated", detail: [...replaced, ...missing].join(", "), apply: writer(file, `${current}${appended}`) };
}

/** Appends to a folder's .gitignore the entries no ignore rule of the repository covers yet; entries are relative to that folder. */
export function gitignoreStep(root: string, folder: string, entries: readonly string[]): Step {
  const at = (file: string): string => (folder === "" ? file : `${folder}/${file}`);
  return ignoreFileStep(
    root,
    at(".gitignore"),
    entries,
    (entry) => spawnSync("git", ["check-ignore", "-q", "--no-index", at(entry)], { cwd: root, stdio: "ignore" }).status !== 0,
  );
}

/**
 * Appends the entries a gitignore-style file lacks; a listed entry counts with or without its leading or trailing slash.
 * An entry anchored at the root, `/name`, replaces the line `name` an older init wrote, which in gitignore syntax matches a
 * folder of the name at any depth; beside a listed `/name` that line is the user's and stays.
 */
export function ignoreEntriesStep(root: string, target: string, entries: readonly string[]): Step {
  const bare = (line: string): string => line.trim().replace(/^\/|\/$/g, "");
  const listed = (current: string): Set<string> => new Set(current.split(/\r?\n/).map(bare));
  const unanchored = new Map(entries.filter((entry) => /^\/[^/]+$/.test(entry)).map((entry) => [entry.slice(1), entry]));
  const anchoredIn = (entry: string, before: string): boolean => before.split(/\r?\n/).some((line) => line.trim().replace(/\/$/, "") === entry);
  return ignoreFileStep(
    root,
    target,
    entries,
    (entry, current) => !listed(current).has(bare(entry)),
    (line, before) => {
      const entry = unanchored.get(line);
      return entry === undefined || anchoredIn(entry, before) ? undefined : entry;
    },
  );
}

/** The repository that develops the harness formats and lints it as its own code; its root ESLint config says so. */
export function developsHarness(root: string): boolean {
  return TOOL_CONFIG_NAMES.eslint.some((name) => {
    const file = path.join(root, name);
    return fs.existsSync(file) && /\bharness:\s*["']lint["']/.test(fs.readFileSync(file, "utf8"));
  });
}

/**
 * The root ignore files: `.prettierignore`, which Prettier and oxfmt read, with the root workspace's entries, the
 * pocketbase folders and the harness; `.eslintignore`, which oxlint reads, with the harness when a workspace uses oxc.
 */
export function rootIgnoreSteps(root: string, workspaces: readonly WorkspaceEntry[]): Step[] {
  const harness = developsHarness(root) ? [] : HARNESS_IGNORED;
  const atRoot = workspaces.find((workspace) => workspace.path === "" && workspace.tools === "eslint-prettier");
  const formatted = atRoot === undefined ? [] : [...prettierIgnored(atRoot), ...pocketbaseFolders(workspaces).map((folder) => `/${folder}`)];
  const prettier = [...formatted, ...harness];
  const oxlint = workspaces.some((workspace) => workspace.tools === "oxc") ? harness : [];
  return [
    ...(prettier.length === 0 ? [] : [ignoreEntriesStep(root, ".prettierignore", prettier)]),
    ...(oxlint.length === 0 ? [] : [ignoreEntriesStep(root, ".eslintignore", oxlint)]),
  ];
}
