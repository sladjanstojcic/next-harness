import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { ignoredPaths } from "./git-ignore.ts";

describe("ignoredPaths", () => {
  it("names the paths the root and nested .gitignore files ignore, never a tracked file, in one call", () => {
    const repo = makeRepo({ ".gitignore": "build/\n", "pocketbase/.gitignore": ".generated/\n", "build/kept.js": "" });
    repo.git("add", "-f", "build/kept.js");
    const files = ["build/out.js", "build/kept.js", "pocketbase/.generated/x.js", "pocketbase/pb_hooks/a.ts", "with space/build/y.js"];
    expect([...ignoredPaths(repo.root, files)].sort()).toEqual(["build/out.js", "pocketbase/.generated/x.js", "with space/build/y.js"]);
    expect(ignoredPaths(repo.root, [])).toEqual(new Set());
  });
});
