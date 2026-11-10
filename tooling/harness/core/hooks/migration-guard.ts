import fs from "node:fs";
import path from "node:path";
import { workspaceOf } from "../../config.ts";
import type { Finding } from "../audit/finding.ts";
import { taskState, type TaskState } from "../gates/repair-budget.ts";
import type { Harness } from "../path-check.ts";
import { git, pinAppliedRefs, type AppliedPins } from "../state/applied-refs.ts";
import { readState, sessionFile } from "../state/state-file.ts";

export const MIGRATION_RULE = "migration-applied";

/** Where a migration counts as applied: a remote ref, or the tree the task started from. */
export interface Applied {
  trees: string[];
  label: string;
}

export function migrationReason(file: string, applied: Applied): string {
  return `${file} is in ${applied.label} and may be applied; restore it with git checkout and add a new migration with supabase migration new <name> instead of editing it.`;
}

export function isMigration(harness: Harness, file: string): boolean {
  const found = workspaceOf(harness.workspaces, file);
  return found?.entry.shape === "supabase" && found.path.startsWith("migrations/");
}

/** Pinned commits, else the tree the task started from (or HEAD without a task). */
function appliedFrom(pins: AppliedPins, fallback: string): Applied {
  if (pins.commits.length > 0) return { trees: pins.commits, label: pins.label };
  return { trees: [fallback], label: fallback === "HEAD" ? "HEAD" : "the tree this task started from" };
}

/**
 * What counts as applied for a task: the remote commits pinned when its prompt arrived, so a push during the task moves
 * nothing. Without a task (a hand-run check, a session with no prompt yet) the refs as they stand, else HEAD.
 */
export function taskApplied(root: string, task: Pick<TaskState, "applied" | "tree"> | null): Applied {
  return task === null ? appliedFrom(pinAppliedRefs(root), "HEAD") : appliedFrom(task.applied, task.tree);
}

export function sessionApplied(root: string, sessionId: string): Applied {
  return taskApplied(root, readState(root, sessionFile("task", sessionId), taskState));
}

function appliedBlobs(root: string, applied: Applied, file: string): string[] {
  return applied.trees.map((tree) => git(root, ["rev-parse", "--verify", "-q", `${tree}:${file}`])).filter((blob): blob is string => blob !== null);
}

function currentBlob(root: string, file: string): string | null {
  const absolute = path.join(root, file);
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? git(root, ["hash-object", "--", file]) : null;
}

/** A migration file an applied ref holds; editing it in place would diverge from what a database already ran. */
export function isAppliedMigration(root: string, file: string, applied: Applied): boolean {
  return appliedBlobs(root, applied, file).length > 0;
}

/** Applied migrations whose working copy now differs from every applied version: edited, deleted or moved away. */
export function migrationFindings(root: string, harness: Harness, changed: Iterable<string>, resolve: () => Applied): Finding[] {
  const files = [...changed].filter((file) => isMigration(harness, file));
  if (files.length === 0) return [];
  const applied = resolve();
  return files
    .filter((file) => {
      const versions = appliedBlobs(root, applied, file);
      const current = currentBlob(root, file);
      return versions.length > 0 && (current === null || !versions.includes(current));
    })
    .map((file): Finding => ({ rule: MIGRATION_RULE, file, message: migrationReason(file, applied) }));
}
