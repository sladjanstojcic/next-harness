import { describe, expect, it } from "vitest";
import { harnessRuleBlocks } from "../presets/eslint-rules.ts";
import { expectedRules } from "../tools/eslint-preset.ts";
import { layoutOf, PRESET_PROBES } from "../tools/eslint/preset-layout.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";

const REQUIRE = "CallExpression[callee.name='require']";
const REQUIRE_CAST = "TSAsExpression > CallExpression[callee.name='require']";
const THIN =
  'import { harnessEslint } from "./tooling/harness/presets/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, layout: "pocketbase" });\n';
const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", lib: ["ES2022"], module: "esnext", moduleResolution: "bundler", strict: true, noEmit: true, types: [] },
  include: ["pb_hooks", "pb_migrations", "shared", "types", "tests"],
});
const VENDORED = "types/pocketbase-0.40.5.d.ts";
/** What the folder's build and PocketBase's first serve write: gitignored, which ESLint does not read. */
const UNOWNED = ["dist/pb_hooks/a.pb.js", "pb_data/types.d.ts"];
const DECLARATIONS = [
  "declare namespace core {\n  interface Record {\n    id: string;\n  }\n}",
  "interface App {\n  [key: string]: any;\n  findRecordById(c: string, id: string): core.Record;\n}",
  "interface RequestEvent {\n  requestInfo(): { body: unknown };\n}",
  "declare const __hooks: string;",
  "declare const console: { log(...data: unknown[]): void };",
  "declare function routerAdd(method: string, path: string, handler: (e: RequestEvent) => void): void;",
].join("\n\n");

const RUN = "interface Done {\n  done: boolean;\n}\n\nexport function run(e: RequestEvent): Done {\n  return { done: e.requestInfo().body === null };\n}\n";

/** One file per case of the brief, with the rule ids ESLint must report there. */
const ROWS: [file: string, code: string, expected: string[]][] = [
  ["pb_hooks/a.pb.ts", 'routerAdd("GET", "/a", (e) => require<typeof import("./a/run.js")>(`${__hooks}/a/run.js`).run(e));\n', []],
  ["pb_hooks/b.pb.ts", 'routerAdd("GET", "/b", (e) => (require(`${__hooks}/a/run.js`) as typeof import("./a/run.js")).run(e));\n', ["no-restricted-syntax"]],
  ["pb_hooks/a/run.ts", RUN, []],
  [
    "pb_hooks/a/read.ts",
    "interface Command {\n  name: string;\n}\n\nexport function read(e: RequestEvent): Command {\n  const body = e.requestInfo().body as unknown as Command;\n  return body;\n}\n",
    ["no-restricted-syntax", "@typescript-eslint/no-unsafe-type-assertion"],
  ],
  [
    "pb_hooks/a/host.ts",
    'type Host = Omit<App, "x">;\n\nexport function find(app: App): void {\n  (app as Host).findRecordById("s", "1");\n}\n',
    ["@typescript-eslint/no-unsafe-call"],
  ],
  ["pb_hooks/a/log.ts", "export function log(): void {\n  console.log(1);\n}\n", ["no-console"]],
];

interface Result {
  filePath: string;
  messages: { ruleId: string | null; message: string }[];
}

describe("the pocketbase preset layout", () => {
  it("is the layout of a pocketbase workspace, probed on the shape's own paths", () => {
    expect(layoutOf({ path: "pocketbase", shape: "pocketbase", next: false })).toBe("pocketbase");
    expect(PRESET_PROBES.pocketbase).toEqual([
      "pb_hooks/{name}.pb.ts",
      "pb_hooks/{name}/{name}.ts",
      "pb_migrations/1_{name}.ts",
      "shared/{name}.ts",
      "tests/{name}/{name}.test.ts",
    ]);
  });

  it("keeps the typed rules, the cast rules and no-console on hook code, and lets require be", () => {
    const hook = expectedRules("pb_hooks/a/b.ts", "pocketbase");
    for (const rule of ["@typescript-eslint/no-unsafe-call", "@typescript-eslint/no-unsafe-type-assertion", "no-console"])
      expect(hook[rule], rule).toBe("error");
    expect(JSON.stringify(hook["no-restricted-syntax"])).not.toContain(JSON.stringify(REQUIRE));
    expect(JSON.stringify(hook["no-restricted-syntax"])).toContain("TSAsExpression > TSAsExpression");

    const test = expectedRules("tests/s/a.test.ts", "pocketbase");
    expect(test["@typescript-eslint/no-non-null-assertion"]).toBe("off");
    expect(JSON.stringify(test["no-restricted-syntax"])).not.toContain(JSON.stringify(REQUIRE));
  });

  it("bans a cast on require's result in every block that sets no-restricted-syntax", () => {
    const syntax = harnessRuleBlocks("pocketbase").flatMap(({ rules }) => (rules["no-restricted-syntax"] === undefined ? [] : [rules["no-restricted-syntax"]]));
    expect(syntax).toHaveLength(3);
    for (const options of syntax) expect(JSON.stringify(options)).toContain(JSON.stringify(REQUIRE_CAST));
    for (const layout of ["app", "app-root", "package", "electron", "spa"] as const)
      expect(JSON.stringify(harnessRuleBlocks(layout)), layout).not.toContain(JSON.stringify(REQUIRE_CAST));
  });

  it("has no React hooks block", () => {
    expect(JSON.stringify(harnessRuleBlocks("pocketbase"))).not.toContain("harness-react-hooks/");
  });

  it("reports casts, unsafe calls and console in hook code, and skips the vendored declarations, dist/ and pb_data/", () => {
    const { root } = consumerRepo({
      "package.json": JSON.stringify({ name: "backend", type: "module" }),
      "tsconfig.json": TSCONFIG,
      "eslint.config.ts": THIN,
      [VENDORED]: `${DECLARATIONS}\n`,
      "types/require.d.ts": "declare function require<T = unknown>(path: string): T;\n",
      ...Object.fromEntries(ROWS.map(([file, code]) => [file, code])),
      [UNOWNED[0] ?? ""]: 'routerAdd("GET", "/a", (e) => require(`${__hooks}/a/run.js`).run(e));\n',
      [UNOWNED[1] ?? ""]: `${DECLARATIONS}\n`,
    });
    const files = [...ROWS.map(([file]) => file), VENDORED, ...UNOWNED];
    const results = JSON.parse(run(root, "eslint", ["-f", "json", ...files]).output) as Result[];
    const found = (file: string) => results.find(({ filePath }) => filePath.endsWith(file))?.messages ?? [{ ruleId: "not linted", message: "" }];
    const ids = (file: string) => [...new Set(found(file).map(({ ruleId }) => ruleId))].sort();
    expect(ROWS.map(([file]) => [file, ids(file)])).toEqual(ROWS.map(([file, , expected]) => [file, [...expected].sort()]));
    for (const file of [VENDORED, ...UNOWNED]) {
      const [ignored, ...more] = found(file);
      expect(more, file).toEqual([]);
      expect(ignored?.ruleId, file).toBeNull();
      expect(ignored?.message, file).toMatch(/ignore/i);
    }
    for (const file of ["pb_hooks/a/read.ts", "pb_hooks/b.pb.ts"])
      for (const { ruleId, message } of found(file)) if (ruleId === "no-restricted-syntax") expect(message, file).toMatch(/\(PocketBase layout\)\.$/);
    expect(
      found("pb_hooks/b.pb.ts")
        .map(({ message }) => message)
        .join(),
    ).toContain('require<typeof import("./<area>/<name>.js")>(...)');
  }, 120_000);
});
