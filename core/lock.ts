import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILE, isWorkspaceFolder, loadConfig, toolsOf, type HarnessConfig } from "../config.ts";
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
export const UNLOCK_COMMAND = /\bharness:unlock\b|cli\.ts\s+unlock\b|harness\/unlock\.json/;
/** `init --force` replaces locked wiring; while the harness is locked it is the user's command. */
export const INIT_FORCE_COMMAND = /(?:\bharness:init\b|cli\.ts\s+init\b)[^;&|]*\s--force\b/;
const unlockState = z.object({ until: z.number() });

export function isLocked(file: string, config?: HarnessConfig): boolean {
  const entries = [
    ...LOCKED_PATHS,
    CONFIG_FILE,
    ...(config?.locked ?? []),
    ...(config?.legacy === undefined ? [] : [config.legacy]),
    ...(config?.upstream === undefined ? [] : [config.upstream]),
  ];
  if (entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry))) return true;
  const folder = path.posix.dirname(file);
  return (
    folder !== "." &&
    WORKSPACE_TOOL_CONFIGS.includes(path.posix.basename(file)) &&
    (config?.workspaces ?? []).some((workspace) => toolsOf(workspace) === "eslint-prettier" && isWorkspaceFolder(workspace, folder))
  );
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
    .filter((file) => isLocked(file, config) && !matchesHead(root, file))
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
