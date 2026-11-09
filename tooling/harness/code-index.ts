import fs from "node:fs";
import path from "node:path";
import { TEST_FILE } from "./structure.ts";

function entries(directory: string): fs.Dirent[] {
  return fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : [];
}

function exportsOf(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const entry of (match[1] ?? "").split(",")) {
      const name = entry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (name) names.add(name);
    }
  }
  for (const match of source.matchAll(/\bexport\s+(?:async\s+|abstract\s+)?(?:function|const|let|type|interface|class|enum)\s+([\w$]+)/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

export function codeIndex(root: string): string {
  const lines = ["# Code index", "", "Reuse these public APIs before adding code. Module internals stay inside their module."];
  const append = (base: string, file: string): void => {
    const absolute = path.join(base, file);
    if (fs.existsSync(absolute))
      lines.push(
        `- \`${file}\`: ${
          exportsOf(absolute)
            .map((name) => `\`${name}\``)
            .join(", ") || "(no named exports)"
        }`,
      );
  };
  const modules = path.join(root, "src/modules");
  for (const entry of entries(modules).filter((entry) => entry.isDirectory())) {
    lines.push("", `## ${entry.name}`, "");
    const base = path.join(modules, entry.name);
    append(base, "index.ts");
    append(base, "server.ts");
    for (const action of entries(path.join(base, "actions")).filter((entry) => entry.isFile() && entry.name.endsWith("-action.ts"))) {
      append(base, `actions/${action.name}`);
    }
  }
  lines.push("", "## shared/lib", "");
  const shared = path.join(root, "src/shared/lib");
  for (const entry of entries(shared).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name))) {
    append(shared, entry.name);
  }
  const markdown = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(markdown) <= 8192) return markdown;
  const note = "\n[Code index truncated at 8 KB. Read module public files for the remaining exports.]\n";
  const bytes = Buffer.from(markdown);
  let end = 8192 - Buffer.byteLength(note);
  while (((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8") + note;
}
