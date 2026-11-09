import { execFileSync } from "node:child_process";

export function listFiles(root: string): string[] {
  const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
  const deleted = new Set(execFileSync("git", ["ls-files", "-d", "-z"], { cwd: root, encoding: "utf8" }).split("\0"));
  return [...new Set(output.split("\0").filter((file) => file !== "" && !deleted.has(file)))].sort();
}
