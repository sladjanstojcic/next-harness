import { spawnSync } from "node:child_process";
import { workspaceOf } from "../../config.ts";
import type { Finding } from "../audit/finding.ts";
import { matchesHead } from "../lock.ts";
import type { Harness } from "../path-check.ts";

export const MIGRATION_RULE = "migration-applied";

export function migrationReason(file: string): string {
  return `${file} is already committed and may be applied; add a new migration with supabase migration new <name> instead of editing it.`;
}

function isMigration(harness: Harness, file: string): boolean {
  const found = workspaceOf(harness.workspaces, file);
  return found?.entry.shape === "supabase" && found.path.startsWith("migrations/");
}

function exists(root: string, tree: string, file: string): boolean {
  return spawnSync("git", ["cat-file", "-e", `${tree}:${file}`], { cwd: root, stdio: "ignore" }).status === 0;
}

function committedEver(root: string, file: string): boolean {
  const result = spawnSync("git", ["rev-list", "-1", "HEAD", "--", file], { cwd: root, encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() !== "";
}

/** A file under a supabase workspace's migrations/ that HEAD holds; it may already be applied to a linked project. */
export function isAppliedMigration(root: string, harness: Harness, file: string): boolean {
  return isMigration(harness, file) && exists(root, "HEAD", file);
}

/**
 * Committed migrations that were changed, deleted or moved away; a new migration file passes.
 * With `base`, the tree before the command or task, a migration counts when it existed there and has been committed,
 * so an edit committed in the same command is still reported. Without it, the working copy is compared to HEAD.
 */
export function migrationFindings(root: string, harness: Harness, changed: Iterable<string>, base?: string): Finding[] {
  const applied = (file: string): boolean =>
    base === undefined
      ? isAppliedMigration(root, harness, file) && !matchesHead(root, file)
      : isMigration(harness, file) && exists(root, base, file) && committedEver(root, file);
  return [...changed].filter(applied).map((file): Finding => ({ rule: MIGRATION_RULE, file, message: migrationReason(file) }));
}
