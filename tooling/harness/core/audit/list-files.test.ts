import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { listFiles } from "./list-files.ts";

describe("listFiles", () => {
  it("skips untracked dependencies at any depth, including a node_modules link", () => {
    const repo = makeRepo({ "src/a.ts": "" });
    repo.write("node_modules/zod/index.js", "");
    repo.write("tooling/harness/node_modules/zod/Index.js", "");
    repo.write("apps/web/node_modules/.bin/next", "");
    fs.symlinkSync(path.join(repo.root, "tooling"), path.join(repo.root, "apps/node_modules"));
    repo.write("src/node_modules-notes.ts", "");
    expect(listFiles(repo.root)).toEqual(["src/a.ts", "src/node_modules-notes.ts"]);
  });
});
