import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILE, loadConfig, type HarnessConfig } from "../config.ts";
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
  "eslint.config.ts",
  "prettier.config.ts",
  ".prettierignore",
  "knip.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  ".dependency-cruiser.json",
  ".jscpd.json",
];
export const UNLOCK_COMMAND = /\bharness:unlock\b|cli\.ts\s+unlock\b|harness\/unlock\.json/;
/** `init --force` replaces locked wiring; while the harness is locked it is the user's command. */
export const INIT_FORCE_COMMAND = /(?:\bharness:init\b|cli\.ts\s+init\b)[^;&|]*\s--force\b/;
const unlockState = z.object({ until: z.number() });

export function isLocked(file: string, config?: HarnessConfig): boolean {
  const entries = [...LOCKED_PATHS, CONFIG_FILE, ...(config?.locked ?? []), ...(config?.legacy === undefined ? [] : [config.legacy])];
  return entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
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
export function matchesHead(root: string, file: string): boolean {
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
