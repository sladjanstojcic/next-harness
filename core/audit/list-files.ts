import { execFileSync } from "node:child_process";

const DEPENDENCIES = /(?:^|\/)node_modules(?:\/|$)/;

export function listFiles(root: string): string[] {
  const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
  const deleted = new Set(execFileSync("git", ["ls-files", "-d", "-z"], { cwd: root, encoding: "utf8" }).split("\0"));
  return [...new Set(output.split("\0").filter((file) => file !== "" && !deleted.has(file) && !DEPENDENCIES.test(file)))].sort();
}

/** Each node_modules folder holding committed files; listFiles skips them, so the audit reports them here. */
export function trackedDependencyFolders(root: string): Map<string, number> {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0");
  const folders = new Map<string, number>();
  for (const file of tracked) {
    const match = /^((?:[^/]*\/)*?node_modules)\//.exec(file);
    if (match?.[1] !== undefined) folders.set(match[1], (folders.get(match[1]) ?? 0) + 1);
  }
  return folders;
}
