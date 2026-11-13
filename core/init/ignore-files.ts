import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sourceRootOf, type WorkspaceEntry } from "../../config.ts";
import { GENERATED_TYPE_GLOBS } from "../../shapes/backend-folder.ts";
import { TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { writer, type Step } from "./files.ts";

export const IGNORED = [".next/", "test-results/"];
/** electron-vite's build output, and the build info `tsc` writes beside each composite project it checks. */
export const ELECTRON_IGNORED = ["out/", "*.tsbuildinfo"];
/** pnpm links the harness's own dependencies here once it is a workspace package; create-next-app ignores only `/node_modules`. */
export const HARNESS_MODULES = "tooling/harness/node_modules/";
/** Files the format check must skip: pnpm's own lockfile style, the vendored shadcn primitives, generated database types and the build output. */
export const prettierIgnored = (workspace: WorkspaceEntry): string[] =>
  workspace.shape === "electron-vite"
    ? ["pnpm-lock.yaml", "src/renderer/src/shared/ui", "out", "dist"]
    : ["pnpm-lock.yaml", `${sourceRootOf(workspace)}shared/ui`, ...GENERATED_TYPE_GLOBS.map((glob) => `${sourceRootOf(workspace)}backend/${glob}`), ".next"];
/**
 * The vendored harness and its locked config. A project's `prettier --write .`, `oxfmt` or `oxlint --fix` would rewrite
 * them in the project's style, which the lock then reports; formatting harness.config.ts is the user's, during an unlock.
 */
const HARNESS_IGNORED = ["tooling/harness", "harness.config.ts"];

/** Appends the entries an ignore file lacks, keeping its lines; `isMissing` decides with the file as it stands. */
function ignoreFileStep(root: string, target: string, entries: readonly string[], isMissing: (entry: string, current: string) => boolean): Step {
  const file = path.join(root, target);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = entries.filter((entry) => isMissing(entry, current));
  if (missing.length === 0) return { target, status: "unchanged", detail: entries.join(", ") };
  const text = `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`;
  return { target, status: current === "" ? "created" : "updated", detail: missing.join(", "), apply: writer(file, text) };
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

/** Appends the entries a gitignore-style file lacks; a listed entry counts with or without its leading or trailing slash. */
export function ignoreEntriesStep(root: string, target: string, entries: readonly string[]): Step {
  const listed = (current: string): Set<string> => new Set(current.split(/\r?\n/).map((line) => line.trim().replace(/^\/|\/$/g, "")));
  return ignoreFileStep(root, target, entries, (entry, current) => !listed(current).has(entry));
}

/** The repository that develops the harness formats and lints it as its own code; its root ESLint config says so. */
export function developsHarness(root: string): boolean {
  return TOOL_CONFIG_NAMES.eslint.some((name) => {
    const file = path.join(root, name);
    return fs.existsSync(file) && /\bharness:\s*["']lint["']/.test(fs.readFileSync(file, "utf8"));
  });
}

/**
 * The root ignore files: `.prettierignore`, which Prettier and oxfmt read, with the root workspace's entries and the
 * harness; `.eslintignore`, which oxlint reads, with the harness when a workspace uses oxc.
 */
export function rootIgnoreSteps(root: string, workspaces: readonly WorkspaceEntry[]): Step[] {
  const harness = developsHarness(root) ? [] : HARNESS_IGNORED;
  const atRoot = workspaces.find((workspace) => workspace.path === "" && workspace.tools === "eslint-prettier");
  const formatted = atRoot === undefined ? [] : prettierIgnored(atRoot);
  const prettier = [...formatted, ...harness];
  const oxlint = workspaces.some((workspace) => workspace.tools === "oxc") ? harness : [];
  return [
    ...(prettier.length === 0 ? [] : [ignoreEntriesStep(root, ".prettierignore", prettier)]),
    ...(oxlint.length === 0 ? [] : [ignoreEntriesStep(root, ".eslintignore", oxlint)]),
  ];
}
