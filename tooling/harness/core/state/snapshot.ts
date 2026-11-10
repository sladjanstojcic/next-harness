import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./state-file.ts";

export function snapshotTree(root: string): string {
  const temporary = fs.mkdtempSync(path.join(stateDir(root), "snapshot-"));
  const index = path.join(temporary, "index");
  try {
    // Seed tracked paths, including files now ignored, without changing the user's staging area.
    const original = path.resolve(root, execFileSync("git", ["rev-parse", "--git-path", "index"], { cwd: root, encoding: "utf8" }).trim());
    if (fs.existsSync(original)) {
      fs.copyFileSync(original, index);
      // Git re-reads a file whose mtime is not older than the index's own mtime ("racily clean"). A fresh copy would
      // disable that check and let a same-size edit made in the same clock tick pass as unchanged.
      const stat = fs.statSync(original);
      fs.utimesSync(index, stat.atime, stat.mtime);
    }
    const options = { cwd: root, env: { ...process.env, GIT_INDEX_FILE: index }, encoding: "utf8" } as const;
    execFileSync("git", ["add", "-A"], options);
    return execFileSync("git", ["write-tree"], options).trim();
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function changedSince(root: string, tree: string): string[] {
  const current = snapshotTree(root);
  return execFileSync("git", ["diff-tree", "-r", "--name-only", "-z", tree, current], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "")
    .sort();
}
