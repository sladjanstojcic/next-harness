import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILE, isWorkspaceFolder, loadConfig, toolsOf, type HarnessConfig, type WorkspaceConfig } from "../config.ts";
import { ELECTRON_CONFIGS } from "../shapes/electron/electron-vite.ts";
import { VITE_CONFIGS } from "../shapes/vite/vite-spa.ts";
import { ALL_TOOL_CONFIG_NAMES } from "../shapes/tool-config-names.ts";
import type { Finding } from "./audit/finding.ts";
import { readState, stateDir, writeState } from "./state/state-file.ts";

export const UNLOCK_HOURS = 4;
/** Files that define the harness itself. An agent can edit them only while the user has unlocked the checkout. */
const LOCKED_PATHS: readonly string[] = [
  "tooling/harness/",
  ".claude/settings.json",
  ".codex/",
  ".githooks/",
  ".github/",
  "tsconfig.json",
  "next.config.ts",
  ...ALL_TOOL_CONFIG_NAMES,
  ".prettierignore",
  ".dependency-cruiser.json",
  ".jscpd.json",
];
/** Every tool config name an eslint-prettier workspace may hold, init's and the project's own, and the tsconfig and Prettier ignore file init edits; locked there as at the root. */
const WORKSPACE_TOOL_CONFIGS: readonly string[] = [...ALL_TOOL_CONFIG_NAMES, ".dependency-cruiser.json", ".jscpd.json", ".prettierignore", "tsconfig.json"];
/** The build configs and every tsconfig*.json of the shapes type-checked project by project, which their type check reads. */
const PROJECT_CONFIGS: Partial<Record<WorkspaceConfig["shape"], RegExp>> = { "electron-vite": ELECTRON_CONFIGS, "vite-spa": VITE_CONFIGS };
export const UNLOCK_COMMAND = /\bharness:unlock\b|cli\.ts\s+unlock\b|harness\/unlock\.json/;
/** `init --force` replaces locked wiring; while the harness is locked it is the user's command. */
export const INIT_FORCE_COMMAND = /(?:\bharness:init\b|cli\.ts\s+init\b)[^;&|]*\s--force\b/;
const unlockState = z.object({ until: z.number() });

/**
 * A workspace folder no commit reachable from HEAD has ever held a file in: a new package or app, whose tool configs its
 * author creates. History, not the tree at HEAD, so that removing an existing workspace in a commit does not reopen it.
 */
export function isNewWorkspace(root: string, folder: string): boolean {
  const touched = spawnSync("git", ["log", "-1", "--format=%H", "HEAD", "--", `${folder}/`], { cwd: root, encoding: "utf8" });
  return touched.status === 0 && touched.stdout.trim() === "";
}

/**
 * `root` lets a new workspace through: its tool configs are open until a commit holds a file of the workspace, and
 * locked from that commit on. Without `root` a workspace's tool configs are always locked.
 */
export function isLocked(file: string, config?: HarnessConfig, root?: string): boolean {
  const entries = [
    ...LOCKED_PATHS,
    CONFIG_FILE,
    ...(config?.locked ?? []),
    ...(config?.legacy === undefined ? [] : [config.legacy]),
    ...(config?.upstream === undefined ? [] : [config.upstream]),
  ];
  if (entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry))) return true;
  const folder = path.posix.dirname(file);
  const name = path.posix.basename(file);
  const inWorkspace = (is: (workspace: WorkspaceConfig) => boolean): boolean =>
    (config?.workspaces ?? []).some((workspace) => is(workspace) && isWorkspaceFolder(workspace, folder === "." ? "" : folder));
  // Locked at the root too, unlike a workspace's tool configs: the root tsconfig.json alone is in LOCKED_PATHS.
  const project = inWorkspace((workspace) => PROJECT_CONFIGS[workspace.shape]?.test(name) === true);
  const toolConfig = folder !== "." && WORKSPACE_TOOL_CONFIGS.includes(name) && inWorkspace((workspace) => toolsOf(workspace) === "eslint-prettier");
  return (project || toolConfig) && !(root !== undefined && folder !== "." && isNewWorkspace(root, folder));
}

export function unlocked(root: string, now = Date.now()): boolean {
  const state = readState(root, "unlock.json", unlockState);
  return state !== null && state.until > now;
}

export function unlock(root: string, now = Date.now()): number {
  const until = now + UNLOCK_HOURS * 3_600_000;
  writeState(root, "unlock.json", { until });
  return until;
}

export function lock(root: string): void {
  fs.rmSync(path.join(stateDir(root), "unlock.json"), { force: true });
}

export function lockReason(file: string): string {
  return `${file} is part of the harness and is locked. Ask the user to run \`pnpm harness:unlock\` in their own terminal (valid ${String(UNLOCK_HOURS)} hours), make the change with them, then \`pnpm harness:lock\`.`;
}

/** A tracked file whose working copy equals its committed version: a revert restored it rather than changed it. */
function matchesHead(root: string, file: string): boolean {
  const options = { cwd: root, stdio: "ignore" } as const;
  const tracked = spawnSync("git", ["cat-file", "-e", `HEAD:${file}`], options).status === 0;
  return tracked && spawnSync("git", ["diff", "--quiet", "HEAD", "--", file], options).status === 0;
}

export function lockFindings(root: string, changed: Iterable<string>, config: HarnessConfig = loadConfig(root)): Finding[] {
  if (unlocked(root)) return [];
  return [...changed]
    .filter((file) => isLocked(file, config, root) && !matchesHead(root, file))
    .map((file): Finding => ({ rule: "harness-lock", file, message: lockReason(file) }));
}

const HARNESS_FOLDER = "tooling/harness";

/** After one shell command, more than three locked files mean a formatter or codemod ran over them: restore, not unlock. */
export function shellLockFindings(root: string, changed: Iterable<string>, config: HarnessConfig = loadConfig(root)): Finding[] {
  const findings = lockFindings(root, changed, config);
  if (findings.length <= 3) return findings;
  const paths = [...new Set(findings.map((finding) => (finding.file.startsWith(`${HARNESS_FOLDER}/`) ? HARNESS_FOLDER : finding.file)))];
  const message = `${String(findings.length)} harness files changed in one command: a formatter or codemod touched them, nobody meant to edit the harness. Restore them with \`git checkout -- ${paths.join(" ")}\` and keep that tool off the harness.`;
  return paths.map((file): Finding => ({ rule: "harness-lock", file, message }));
}
