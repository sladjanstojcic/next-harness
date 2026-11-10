import { spawnSync } from "node:child_process";
import { z } from "zod";

/** The commits whose migrations count as applied, pinned when a task starts so a push during the task cannot move them. */
export const appliedPins = z.object({ commits: z.array(z.string().min(1)), label: z.string() });
export type AppliedPins = z.infer<typeof appliedPins>;

/** A git command's trimmed output, or null when it fails; `git replace` cannot redirect a pinned commit. */
export function git(root: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" } });
  return result.status === 0 ? result.stdout.trim() : null;
}

const REMOTES = "refs/remotes/";

/** A remote-tracking ref's short name and commit; origin/HEAD resolves to the branch it points at. */
function remoteRef(root: string, ref: string): { name: string; commit: string } | undefined {
  const target = ref.endsWith("/HEAD") ? (git(root, ["symbolic-ref", "-q", ref]) ?? ref) : ref;
  const commit = git(root, ["rev-parse", "--verify", "-q", `${target}^{commit}`]);
  return commit === null || !target.startsWith(REMOTES) ? undefined : { name: target.slice(REMOTES.length), commit };
}

/** The remote default branch: `origin/HEAD`, else `origin/main`, else `origin/master`. */
export function remoteDefault(root: string): { name: string; commit: string } | undefined {
  return ["origin/HEAD", "origin/main", "origin/master"].map((ref) => remoteRef(root, `${REMOTES}${ref}`)).find((found) => found !== undefined);
}

/**
 * The branch's upstream when it is a remote-tracking branch, and the remote default branch (`origin/HEAD`, else
 * `origin/main`, else `origin/master`), resolved to commits now. An empty list means the task's own snapshot decides.
 */
export function pinAppliedRefs(root: string): AppliedPins {
  const upstream = git(root, ["rev-parse", "--symbolic-full-name", "@{upstream}"]);
  const candidates = [...(upstream?.startsWith(REMOTES) === true ? [remoteRef(root, upstream)] : []), remoteDefault(root)].filter(
    (found) => found !== undefined,
  );
  const names = [...new Set(candidates.map((found) => found.name))];
  return { commits: [...new Set(candidates.map((found) => found.commit))], label: names.join(" or ") };
}
