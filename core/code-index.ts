import path from "node:path";
import { resolveHarness } from "./path-check.ts";

export function codeIndex(root: string): string {
  const lines = ["# Code index", "", "Reuse these public APIs before adding code. Module internals stay inside their module."];
  for (const workspace of resolveHarness(root).workspaces) {
    if (workspace.path !== "") lines.push("", `# ${workspace.path}`);
    lines.push(...workspace.shapeImpl.codeIndex(path.join(root, workspace.path)));
  }
  const markdown = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(markdown) <= 8192) return markdown;
  const note = "\n[Code index truncated at 8 KB. Read module public files for the remaining exports.]\n";
  const bytes = Buffer.from(markdown);
  let end = 8192 - Buffer.byteLength(note);
  while (((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8") + note;
}
