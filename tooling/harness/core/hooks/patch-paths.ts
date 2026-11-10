interface PatchPath {
  path: string;
  op: "add" | "update" | "delete" | "move-from" | "move-to";
}
export function patchPaths(patch: string): PatchPath[] {
  let lines = patch.replaceAll("\r\n", "\n").trim().split("\n");
  if (["<<EOF", "<<'EOF'", '<<"EOF"'].includes(lines[0] ?? "") && lines.at(-1)?.endsWith("EOF") && lines.length >= 4) {
    lines = lines.slice(1, -1);
  }
  if (lines[0]?.trim() !== "*** Begin Patch" || lines.at(-1)?.trim() !== "*** End Patch") throw new Error("Expected a complete patch");
  const paths: PatchPath[] = [];
  let moveAllowed = false;
  let inUpdate = false;
  for (const [index, raw] of lines.slice(1, -1).entries()) {
    // In an Update body a leading space is the context-line prefix, not marker indentation.
    const line = inUpdate ? raw.trimEnd() : raw.trim();
    if (index === 0 && /^\*\*\* Environment ID: .+$/.test(line)) continue;
    const operation = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (operation?.[1] && operation[2]) {
      const file = operation[2];
      if (!file.trim() || file.includes("\0")) throw new Error("Invalid patch path");
      const op = operation[1] === "Add" ? "add" : operation[1] === "Update" ? "update" : "delete";
      paths.push({ path: file, op });
      moveAllowed = op === "update";
      inUpdate = op === "update";
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(moveAllowed ? raw.trim() : line);
    if (move?.[1]) {
      const previous = paths.at(-1);
      if (!moveAllowed || previous?.op !== "update" || move[1].includes("\0")) throw new Error("Invalid move target");
      previous.op = "move-from";
      paths.push({ path: move[1], op: "move-to" });
      moveAllowed = false;
      continue;
    }
    moveAllowed = false;
    if (line.startsWith("*** ") && line !== "*** End of File") throw new Error("Unsupported patch header");
    if (paths.length === 0) throw new Error("Patch content precedes its file header");
  }
  if (paths.length === 0) throw new Error("Patch has no file operations");
  return paths;
}
