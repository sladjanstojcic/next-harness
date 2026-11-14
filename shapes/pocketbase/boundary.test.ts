import ts from "typescript";
import { describe, expect, it } from "vitest";
import { pocketbaseBoundary } from "./boundary.ts";

const WORKSPACES = ["pocketbase"];
const APP_FILE = "src/modules/listings/server/load.ts";
const SHARED_FILE = "pocketbase/shared/listing-values.ts";

function found(file: string, text: string, workspaces: readonly string[] = WORKSPACES): [string, number, string][] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return pocketbaseBoundary(file, source, workspaces, ts).map(({ rule, line, message }) => [rule, line, message]);
}

const FORMS: readonly ((specifier: string) => string)[] = [
  (specifier) => `import { x } from "${specifier}";\n`,
  (specifier) => `import type { X } from "${specifier}";\n`,
  (specifier) => `export { x } from "${specifier}";\n`,
  (specifier) => `export type { X } from "${specifier}";\n`,
  (specifier) => `import x = require("${specifier}");\n`,
  (specifier) => `const x = require("${specifier}");\n`,
  (specifier) => `const x = import("${specifier}");\n`,
  (specifier) => `let x: import("${specifier}").X;\n`,
];

const INTO_HOOKS = "../../../../pocketbase/pb_hooks/sessions/end-session.ts";
const OUT_TO_APP = "../../src/modules/listings/domain/status.ts";
const APP_MESSAGE =
  "Import only pocketbase/shared/ from the app: hooks, migrations and declarations run inside PocketBase, not in the app (PocketBase layout).";
const WORKSPACE_MESSAGE =
  "Keep pocketbase/ to its own files: PocketBase loads only what is in this folder, and the app's code is not there (PocketBase layout).";

describe("the pocketbase import boundary", () => {
  it.each(FORMS.map((form) => [form(INTO_HOOKS)]))("reports the app importing past pocketbase/shared/: %s", (text) => {
    expect(found(APP_FILE, `\n${text}`)).toEqual([["pb-boundary", 2, APP_MESSAGE]]);
  });

  it.each(FORMS.map((form) => [form(OUT_TO_APP)]))("reports the workspace importing from outside its folder: %s", (text) => {
    expect(found(SHARED_FILE, `\n${text}`)).toEqual([["pb-boundary", 2, WORKSPACE_MESSAGE]]);
  });

  it.each([
    ["pocketbase/types/contracts.ts", "../../../../pocketbase/types/contracts.ts"],
    ["the workspace folder itself", "../../../../pocketbase"],
  ])("reports the app importing %s", (_, specifier) => {
    expect(found(APP_FILE, `import "${specifier}";\n`)).toEqual([["pb-boundary", 1, APP_MESSAGE]]);
  });

  it.each([
    [APP_FILE, 'import { x } from "../../../../pocketbase/shared/x.ts";\n'],
    [APP_FILE, 'import type { X } from "../../../../pocketbase/shared/x.ts";\n'],
    ["pocketbase/tests/sessions/end.test.ts", 'import { x } from "../../shared/x.ts";\n'],
    ["pocketbase/pb_hooks/sessions.pb.ts", 'let x: import("./sessions/a.ts").X;\n'],
    ["pocketbase/pb_hooks/sessions.pb.ts", "const x = require(`${__hooks}/sessions/a.ts`);\n"],
    [APP_FILE, 'import PocketBase from "pocketbase";\n'],
    [SHARED_FILE, 'import type { X } from "pocketbase";\n'],
    [APP_FILE, 'import { x } from "@/modules/listings/index.ts";\n'],
    [SHARED_FILE, 'import { x } from "@/modules/listings/index.ts";\n'],
  ])("accepts %s: %s", (file, text) => {
    expect(found(file, text)).toEqual([]);
  });

  it("reports nothing in a repository without a pocketbase workspace", () => {
    expect(found("src/x.ts", 'import { x } from "../pocketbase/pb_hooks/a.ts";\n', [])).toEqual([]);
  });
});
