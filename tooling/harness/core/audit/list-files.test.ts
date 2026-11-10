import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { audit } from "./audit.ts";
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

  it("leaves committed dependencies to the audit, which reports each node_modules folder whatever its class", () => {
    const repo = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: ".", shape: "next-modules" }], owned: ["src/"] };\n',
      "src/a.ts": "",
    });
    for (const file of ["tooling/harness/node_modules/.bin/eslint", "tooling/harness/node_modules/eslint", "node_modules/zod/index.js"]) repo.write(file, "");
    expect(audit(repo.root).filter(({ rule }) => rule === "tracked-node-modules")).toEqual([]);
    repo.git("add", "-f", "tooling/harness/node_modules", "node_modules");
    expect(listFiles(repo.root)).not.toContain("node_modules/zod/index.js");
    expect(audit(repo.root).filter(({ rule }) => rule === "tracked-node-modules")).toEqual([
      {
        rule: "tracked-node-modules",
        file: "node_modules",
        message: "1 committed file; remove them with `git rm -r --cached node_modules` and ignore the folder in .gitignore.",
      },
      {
        rule: "tracked-node-modules",
        file: "tooling/harness/node_modules",
        message: "2 committed files; remove them with `git rm -r --cached tooling/harness/node_modules` and ignore the folder in .gitignore.",
      },
    ]);
  });
});
