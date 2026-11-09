import { spawnSync } from "node:child_process";

export function isIgnored(root: string, file: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", file], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error("Cannot check Git ignores; repair the repository before placing code in src/ or tooling/.");
  return result.status === 0;
}
