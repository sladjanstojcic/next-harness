import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { workspaceOf } from "../../config.ts";
import type { Finding } from "../audit/finding.ts";
import { isLocked } from "../lock.ts";
import type { Harness } from "../path-check.ts";

export const LINT_CONFIG_RULE = "nested-lint-config";

const OXLINT_CONFIG = /^(?:\.oxlintrc\.jsonc?|\.oxlintignore|\.eslintignore|oxlint\.config\.[cm]?[jt]s)$/;
const ESLINT_CONFIG = /^eslint\.config\.[cm]?[jt]s$/;
const DEPENDENCIES = /(?:^|\/)node_modules(?:\/|$)/;
const ROOT_OXLINT = ".oxlintrc.json";

const hasOxc = (harness: Harness): boolean => harness.workspaces.some((workspace) => workspace.tools === "oxc");
/** Without harness.config.ts the template runs ESLint 9, which reads only the config found from its working folder. */
const watchesEslint = (harness: Harness): boolean => harness.configured && harness.workspaces.some((workspace) => workspace.tools === "eslint-prettier");

/** The workspace path when `file` is an ESLint config below the top of an eslint-prettier workspace. */
function eslintWorkspace(harness: Harness, file: string): string | undefined {
  if (!watchesEslint(harness) || !ESLINT_CONFIG.test(path.posix.basename(file))) return undefined;
  const found = workspaceOf(harness.workspaces, file);
  return found !== undefined && found.entry.tools === "eslint-prettier" && found.path.includes("/") ? found.entry.path : undefined;
}

/**
 * A lint config below where the project keeps its own. oxlint, and ESLint from version 10, let the nearest config replace
 * the project's for its folder, so one such file strips the rules from everything below it.
 */
export function isNestedLintConfig(harness: Harness, file: string): boolean {
  if (!file.includes("/")) return false;
  return (OXLINT_CONFIG.test(path.posix.basename(file)) && hasOxc(harness)) || eslintWorkspace(harness, file) !== undefined;
}

export function lintConfigReason(harness: Harness, file: string): string {
  const workspace = eslintWorkspace(harness, file);
  if (workspace !== undefined) {
    const top = workspace === "" ? "the repository root" : `${workspace}/`;
    return `${file} would replace the workspace's ESLint config for its folder; lint rules belong in the ESLint config at ${top}, which the harness locks. Ask the user to change that config instead.`;
  }
  const lock = isLocked(ROOT_OXLINT, harness.config) ? "which harness.config.ts locks" : "which harness.config.ts should list in locked";
  return `${file} would replace the project's lint rules for its folder; they belong in the root ${ROOT_OXLINT}, ${lock}. Ask the user to change the root config instead.`;
}

function gitFiles(root: string, args: string[]): string[] {
  return execFileSync("git", ["ls-files", ...args, "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0");
}

/**
 * Every nested lint config on disk, tracked, untracked or git-ignored: lint tools read ignored files too. Wholly ignored
 * folders such as node_modules/ come back as one entry; the files a config there would govern are ignored as well.
 */
export function lintConfigFindings(root: string, harness: Harness): Finding[] {
  if (!hasOxc(harness) && !watchesEslint(harness)) return [];
  const listed = new Set([...gitFiles(root, ["-co", "--exclude-standard"]), ...gitFiles(root, ["-oi", "--exclude-standard", "--directory"])]);
  return [...listed]
    .filter((file) => !DEPENDENCIES.test(file) && isNestedLintConfig(harness, file) && fs.existsSync(path.join(root, file)))
    .sort()
    .map((file): Finding => ({ rule: LINT_CONFIG_RULE, file, message: lintConfigReason(harness, file) }));
}
