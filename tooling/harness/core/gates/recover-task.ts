import { spawnSync } from "node:child_process";
import { taskApplied, type Applied } from "../hooks/migration-guard.ts";
import { git } from "../state/applied-refs.ts";

function names(root: string, args: string[]): string[] {
  const result = spawnSync("git", [...args, "-z"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.split("\0").filter((file) => file !== "") : [];
}

/**
 * What a Stop with neither a task state nor a shell copy judges: every path that differs from HEAD (staged, unstaged,
 * untracked), plus the files of the commits since the branch's upstream; migrations against the refs as they stand.
 */
export function recoveryScope(root: string): { changed: string[]; applied: Applied } {
  const head = git(root, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  const base = head === null ? null : git(root, ["merge-base", "HEAD", "@{upstream}"]);
  const working =
    head === null
      ? names(root, ["ls-files", "--cached", "--others", "--exclude-standard"])
      : [...names(root, ["diff", "--name-only", "HEAD"]), ...names(root, ["ls-files", "--others", "--exclude-standard"])];
  const committed = base === null ? [] : names(root, ["diff", "--name-only", base, "HEAD"]);
  return { changed: [...new Set([...working, ...committed])].sort(), applied: taskApplied(root, null) };
}
