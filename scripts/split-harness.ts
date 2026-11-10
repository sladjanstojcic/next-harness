import { execFileSync } from "node:child_process";

const PREFIX = "tooling/harness";
const BRANCH = "harness";

export interface SplitResult {
  branch: "harness";
  commit: string;
  warning?: string;
}

export function splitHarness(root: string): SplitResult {
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git("status", "--porcelain", "--", PREFIX) !== "") throw new Error(`Uncommitted changes under ${PREFIX} are not in the split; commit them first.`);
  const commit = git("subtree", "split", `--prefix=${PREFIX}`).split("\n").at(-1) ?? "";
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error(`git subtree split printed no commit for ${PREFIX}.`);
  const previous = git("for-each-ref", "--format=%(objectname)", `refs/heads/${BRANCH}`);
  git("branch", "-f", BRANCH, commit);
  if (previous === "" || descends(git, previous, commit)) return { branch: BRANCH, commit };
  return {
    branch: BRANCH,
    commit,
    warning: `Branch ${BRANCH} moved from ${previous} to ${commit}, which does not descend from it; consumers pulling ${BRANCH} will see rewritten history.`,
  };
}

function descends(git: (...args: string[]) => string, ancestor: string, commit: string): boolean {
  try {
    git("merge-base", "--is-ancestor", ancestor, commit);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  try {
    const { branch, commit, warning } = splitHarness(process.cwd());
    if (warning) console.warn(`Warning: ${warning}`);
    console.log(`Branch ${branch} now points at ${commit}.`);
    console.log(`Publish it yourself with: git push origin ${branch}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
