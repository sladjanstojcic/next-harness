import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ts } from "../tools/typescript.ts";

const harness = path.resolve(import.meta.dirname, "..");
const PACKAGES: readonly string[] = ["zod", "typescript", "vitest"];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

function outside(file: string, target: string): boolean {
  if (target.startsWith(".")) return path.relative(harness, path.resolve(path.dirname(file), target)).startsWith("..");
  return !target.startsWith("node:") && !PACKAGES.includes(target);
}

describe("the harness as a subtree", () => {
  it("imports only its own files, Node built-ins, zod, typescript and vitest", () => {
    const leaks = sources(harness).flatMap((file) =>
      ts
        .preProcessFile(fs.readFileSync(file, "utf8"), true, true)
        .importedFiles.filter(({ fileName }) => outside(file, fileName))
        .map(({ fileName }) => `${path.relative(harness, file)}: ${fileName}`),
    );
    expect(leaks).toEqual([]);
  });
});
