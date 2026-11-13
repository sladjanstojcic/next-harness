import { describe, expect, it } from "vitest";
import type { ShapeName } from "../config.ts";
import { shapeOf } from "../shapes/index.ts";
import { GUIDE_LIMITS, guideName, readGuide } from "./guides.ts";

const SHAPES: readonly ShapeName[] = ["next-modules", "package", "electron-vite", "vite-spa", "makerkit-app", "makerkit-feature", "supabase", "e2e"];
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  module: "billing",
  area: "pricing",
  name: "invoice",
  suite: "checkout",
  segment: "invoices",
  collection: "docs",
  locale: "en",
  timestamp: "20261113120000",
  NN: "01",
  namespace: "billing",
};
/** A folder the tree names without a file gets one; these folders take only names of their own kind. */
const FILE_IN: Readonly<Record<string, string>> = { hooks: "use-invoice.ts", actions: "invoice-action.ts", assets: "logo.svg" };

/** The file put in a folder the tree lists without one: a route folder under app/ takes a page, other folders a module. */
function fileIn(folder: string): string {
  const parts = folder.split("/").slice(0, -1);
  const last = parts.at(-1) ?? "";
  return FILE_IN[last] ?? (parts.includes("app") && !last.startsWith("_") ? "page.tsx" : "invoice.ts");
}

/** Workspace paths the guide's first `text` block names, with placeholders filled and a file in each folder that names none. */
function treePaths(guide: string): string[] {
  const tree = /```text\n([\s\S]*?)```/.exec(guide)?.[1] ?? "";
  const lines = tree.split("\n").filter((line) => line.trim() !== "");
  const parents: string[] = [];
  const paths: string[] = [];
  lines.forEach((line, index) => {
    const depth = (line.length - line.trimStart().length) / 2;
    const nextDepth = ((lines[index + 1] ?? "").length - (lines[index + 1] ?? "").trimStart().length) / 2;
    const names = (line.trim().split(/\s{2,}/)[0] ?? "").split(", ").filter((entry) => !entry.includes(" "));
    for (const entry of names) {
      const filled = entry
        .replace(/<(\w+)>/g, (_, key: string) => PLACEHOLDERS[key] ?? `<${key}>`)
        .replace(/^\*/, "index")
        .replaceAll("*", "");
      const path = `${depth === 0 ? "" : (parents[depth - 1] ?? "")}${filled}`;
      if (!path.endsWith("/")) paths.push(path);
      else if (names.length === 1 && nextDepth > depth) parents[depth] = path;
      else paths.push(`${path}${fileIn(path)}`);
    }
  });
  return paths;
}

describe("the guides", () => {
  it.each(Object.entries(GUIDE_LIMITS))("%s stays within %i lines and has its sections", (name, limit) => {
    const text = readGuide(name);
    expect(text.split("\n").length).toBeLessThanOrEqual(limit);
    const sections =
      name === "common" ? ["## Checks and the lock", "## Repair budget", "## What linters cannot see"] : ["## Architecture and why", "## Where code goes"];
    expect(text.match(/^## .+$/gm)).toEqual(sections);
    expect(text).not.toMatch(/harness:(?:start|end)/);
  });

  it("has a guide for every shape and for the layout without src/", () => {
    for (const shape of SHAPES) expect(() => readGuide(guideName({ shape }))).not.toThrow();
    expect(guideName({ shape: "next-modules", sourceRoot: "" })).toBe("next-modules-root");
    expect(guideName({ shape: "next-modules", sourceRoot: "src/" })).toBe("next-modules");
  });

  it.each([...SHAPES, "next-modules-root"])("%s names only paths its shape accepts", (name) => {
    const shape = name === "next-modules-root" ? shapeOf("next-modules", "") : shapeOf(name as ShapeName);
    const paths = treePaths(readGuide(name));
    expect(paths.length).toBeGreaterThan(0);
    const refused = paths.flatMap((path) => {
      const top = path.split("/")[0] ?? "";
      const known = path.includes("/") ? shape.topFolders.includes(top) : shape.topEntries.includes(top) || shape.topEntryPattern?.test(top) === true;
      const verdict = shape.checkPath(path);
      return !path.includes("<") && known && verdict.ok ? [] : [`${path}: ${verdict.ok ? "not a top entry" : verdict.reason}`];
    });
    expect(refused).toEqual([]);
  });

  it("throws on an unknown name", () => {
    expect(() => readGuide("nope")).toThrow('No guide for "nope"');
  });
});
