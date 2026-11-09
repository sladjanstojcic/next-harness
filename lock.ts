import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
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
const unlockState = z.object({ until: z.number() });

export function isLocked(file: string): boolean {
  return LOCKED_PATHS.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
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

export function lockFindings(root: string, changed: Iterable<string>): Finding[] {
  if (unlocked(root)) return [];
  return [...changed].filter(isLocked).map((file): Finding => ({ rule: "harness-lock", file, message: lockReason(file) }));
}
