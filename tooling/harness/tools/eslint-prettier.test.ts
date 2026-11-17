import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageShape } from "../shapes/package.ts";
import { makeRepo } from "../testing/temp-repo.ts";
import { eslintPrettier } from "./eslint-prettier.ts";

const args = (step: { command: string[] }): string => step.command.slice(1).join(" ");

describe("the Prettier steps of the eslint-prettier tool set", () => {
  it("leave out each file the shape vendors, which a package has no .prettierignore for", () => {
    const repo = makeRepo({ "packages/db/src/server/database.types.ts": "", "packages/db/src/server/rows.ts": "", "packages/db/src/index.ts": "" });
    const dir = path.join(repo.root, "packages/db");
    const vendored = packageShape.vendoredPattern;
    const check = eslintPrettier.format.check(dir, vendored);
    expect("command" in check ? args(check) : "").toBe("--check . !src/server/database.types.ts");
    const report = eslintPrettier.format.report?.(dir, vendored);
    expect(report === undefined ? "" : args(report)).toBe("--list-different . !src/server/database.types.ts");
    const whole = eslintPrettier.format.check(dir);
    expect("command" in whole ? args(whole) : "").toBe("--check .");
  });
});
