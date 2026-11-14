import ts from "typescript";
import { describe, expect, it } from "vitest";
import { pocketbaseSourceRules } from "./source-rules.ts";

const ENTRY = "pb_hooks/sessions.pb.ts";

function rules(name: string, text: string): [string, number][] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  return pocketbaseSourceRules(name, source, ts).map(({ rule, line }) => [rule, line]);
}

describe("pocketbase source rules", () => {
  it.each([
    ['import { end } from "./sessions/end-session.ts";\n', [["pb-entry-module", 1]]],
    ['import type { Session } from "../types/contracts.ts";\n', [["pb-entry-module", 1]]],
    ["export const version = 1;\n", [["pb-entry-module", 1]]],
    ["export type Mode = 'a';\n", [["pb-entry-module", 1]]],
    ["const x = 1;\nexport {};\n", [["pb-entry-module", 2]]],
    ['import api = require("./sessions/api");\n', [["pb-entry-module", 1]]],
    ['import type api = require("./sessions/api");\n', [["pb-entry-module", 1]]],
  ])("reports top-level module syntax in an entry: %s", (text, expected) => {
    expect(rules(ENTRY, text)).toEqual(expected);
  });

  it("accepts an entry that takes its types through import() expressions and requires inside the handler", () => {
    const text =
      'routerAdd("POST", "/x", (e) => {\n  const s: import("./sessions/end-session.ts").Api = require(`${__hooks}/sessions/end-session.js`);\n  return s.end(e);\n});\n';
    expect(rules(ENTRY, text)).toEqual([]);
  });

  it("accepts a namespace alias in an entry: it leaves the file a script", () => {
    expect(rules(ENTRY, "namespace Pb { export const n = 1; }\nimport n = Pb.n;\n")).toEqual([]);
  });

  it.each([
    ['const api = require("./a.js");\n', 1],
    ['if (true) {\n  require("./a.js");\n}\n', 2],
    ['function f(x = require("./a.js")) { return x; }\n', 1],
  ])("reports require outside a function body: %s", (text, line) => {
    expect(rules(ENTRY, text)).toEqual([["pb-require-scope", line]]);
  });

  it.each([
    'onBootstrap((e) => { const a = require("./a.js"); e.next(); });\n',
    'function load() { return require("./a.js"); }\n',
    'const o = { run() { return require("./a.js"); } };\n',
  ])("accepts require inside a function body: %s", (text) => {
    expect(rules(ENTRY, text)).toEqual([]);
  });

  it("leaves a required module alone: it is a CommonJS module and may import and export", () => {
    expect(rules("pb_hooks/sessions/end-session.ts", 'import type { A } from "../../types/contracts.ts";\nexport function end() {}\n')).toEqual([]);
  });

  it.each([
    ['const a = require("./a.js");\n', 1],
    ["export const n = $app.settings();\n", 1],
    ['import fs from "node:fs";\n', 1],
    ['import { join } from "path";\n', 1],
    ["export const u = $http.send({});\n", 1],
    ["export const s = { $app };\n", 1],
    ["export const c = { [$app]: 1 };\n", 1],
  ])("reports what makes shared/ unloadable on one side: %s", (text, line) => {
    expect(rules("shared/listing-values.ts", text)).toEqual([["pb-shared-pure", line]]);
  });

  it.each(["export const { $app: value } = data;\n", 'import { $app as value } from "./values.ts";\n'])(
    "accepts a PocketBase global's name as a renamed property key in shared/: %s",
    (text) => {
      expect(rules("shared/listing-values.ts", text)).toEqual([]);
    },
  );

  it("accepts plain values, types and a relative import in shared/", () => {
    expect(
      rules("shared/listing-values.ts", 'import { A } from "./other-values.ts";\nexport const LIST = [A] as const;\nexport type L = (typeof LIST)[number];\n'),
    ).toEqual([]);
  });
});
