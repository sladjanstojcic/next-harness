import { spawnSync } from "node:child_process";

const FAILED = "Cannot check Git ignores; repair the repository before placing code in src/ or tooling/.";

export function isIgnored(root: string, file: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", file], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(FAILED);
  return result.status === 0;
}

/** The files among `files` (relative to `root`) that git ignores, asked in one call; a tracked file is never ignored. */
export function ignoredPaths(root: string, files: readonly string[]): Set<string> {
  const inside = files.filter((file) => file !== "" && !file.startsWith("../") && !file.startsWith("/"));
  if (inside.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "-z", "--stdin"], { cwd: root, encoding: "utf8", input: `${inside.join("\0")}\0` });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`${FAILED}\n${result.stderr.trim()}`);
  return new Set(result.stdout.split("\0").filter((file) => file !== ""));
}

/** Whether git ignores anything in `folder` (relative to `root`, "" for the root) besides node_modules, which every tool skips. */
export function holdsIgnored(root: string, folder: string): boolean {
  const args = ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory", "-z", "--", folder === "" ? "." : folder];
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${FAILED}\n${result.stderr.trim()}`);
  return result.stdout.split("\0").some((entry) => entry !== "" && !entry.split("/").includes("node_modules"));
}
