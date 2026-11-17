import fs from "node:fs";
import path from "node:path";
import { type ShapeName, workspaceOf } from "../../config.ts";
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

interface MigrationFolder {
  folder: string;
  advice: string;
}

const SUPABASE: MigrationFolder = { folder: "migrations/", advice: "add a new migration with supabase migration new <name>" };

const MIGRATIONS: Partial<Record<ShapeName, MigrationFolder>> = {
  supabase: SUPABASE,
  pocketbase: { folder: "pb_migrations/", advice: "add a new migration file in pb_migrations/" },
};

function migrationFolder(harness: Harness, file: string): MigrationFolder | undefined {
  const found = workspaceOf(harness.workspaces, file);
  if (found === undefined) return undefined;
  const migrations = MIGRATIONS[found.entry.shape];
  return migrations !== undefined && found.path.startsWith(migrations.folder) ? migrations : undefined;
}

export function migrationReason(harness: Harness, file: string, applied: Applied): string {
  const { advice } = migrationFolder(harness, file) ?? SUPABASE;
  return `${file} is in ${applied.label} and may be applied; restore it with git checkout and ${advice} instead of editing it.`;
}

export function isMigration(harness: Harness, file: string): boolean {
  return migrationFolder(harness, file) !== undefined;
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
    .map((file): Finding => ({ rule: MIGRATION_RULE, file, message: migrationReason(harness, file, applied) }));
}

/** What CI and the legacy list count as applied: the remote commits alone, so a migration new in the branch is never forgiven. */
export function remoteApplied(root: string): Applied {
  const pins = pinAppliedRefs(root);
  return { trees: pins.commits, label: pins.label };
}

/** Whether an applied commit holds any file in a workspace's migration folder. */
export function holdsAppliedMigrations(root: string, harness: Harness, workspacePath: string, resolve: () => Applied): boolean {
  const folder = harness.workspaces.find((entry) => entry.path === workspacePath);
  const migrations = folder === undefined ? undefined : MIGRATIONS[folder.shape];
  if (migrations === undefined) return false;
  const at = path.posix.join(workspacePath, migrations.folder);
  return resolve().trees.some((tree) => (git(root, ["ls-tree", "-r", "--name-only", tree, "--", at]) ?? "") !== "");
}
