import { makeRepo, type RepoFixture } from "../temp-repo.ts";
import { templateRepo } from "../template-repo.ts";

export const PB = "pocketbase";
export const PB_MIGRATION = "pocketbase/pb_migrations/001_first_collection.ts";

const CONFIG = `export default {
  workspaces: [
    { path: ".", shape: "next-modules", next: true },
    { path: "pocketbase", shape: "pocketbase", tools: "oxc" },
  ],
  root: { entries: ["pocketbase"] },
};
`;

/** The project's own files, without the tool stubs, for a fixture that links real tools. */
export const POCKETBASE_PROJECT: Readonly<Record<string, string>> = {
  "harness.config.ts": CONFIG,
  ".gitignore": "node_modules/\n",
  "package.json": "{}\n",
  "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
  "src/app/layout.tsx": "export default function Layout() { return null; }\n",
  "src/app/page.tsx": "export default function Page() { return null; }\n",
  "pocketbase/tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
  "pocketbase/pb_hooks/sessions.pb.ts": [
    'routerAdd("POST", "/api/sessions/end", (event: { json(status: number, body: unknown): void }) => {',
    '  const { endSession } = require(`${__hooks}/sessions/end-session.ts`) as typeof import("./sessions/end-session.ts");',
    "  event.json(200, endSession());",
    "});",
    "",
  ].join("\n"),
  "pocketbase/pb_hooks/sessions/end-session.ts": "export function endSession(): { ended: boolean } {\n  return { ended: true };\n}\n",
  [PB_MIGRATION]: "migrate(() => undefined, () => undefined);\n",
};

const TOOL_STUBS: Readonly<Record<string, string>> = {
  "node_modules/.bin/eslint": "",
  "node_modules/.bin/prettier": "",
  "node_modules/.bin/tsc": "",
  "node_modules/.bin/oxlint": "",
  "node_modules/.bin/oxfmt": "",
};

/** A Next app at the root with its PocketBase backend in pocketbase/: an entry, the code it requires, and one committed migration. */
export function pocketbaseRepo(extra: Readonly<Record<string, string>> = {}): RepoFixture {
  return makeRepo({ ...POCKETBASE_PROJECT, ...TOOL_STUBS, ...extra }, { agents: true, stack: true });
}

/** The folder's tsconfig.json, as Prettier formats it. */
const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": []
  },
  "include": ["pb_hooks", "pb_migrations", "types"]
}
`;

/** A stand-in for the declarations PocketBase writes to pb_data/types.d.ts: only what the fixture's files call. */
const DECLARATIONS = [
  "declare const __hooks: string;",
  "declare function routerAdd(method: string, path: string, handler: (event: { json(status: number, body: unknown): void }) => void): void;",
  "declare function migrate(up: () => void, down: () => void): void;",
  "",
].join("\n");

/** The folder on ESLint and Prettier: the configs init writes, the require declaration, and the entry in the generic form. */
function eslintFolder(folder: string): Record<string, string> {
  const presets = `${"../".repeat(folder.split("/").length)}tooling/harness/presets`;
  return {
    [`${folder}/eslint.config.ts`]: `import { harnessEslint } from "${presets}/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, layout: "pocketbase" });\n`,
    [`${folder}/prettier.config.ts`]: `export { default } from "${presets}/prettier.ts";\n`,
    [`${folder}/tsconfig.json`]: TSCONFIG,
    [`${folder}/types/pocketbase-0.40.5.d.ts`]: DECLARATIONS,
    [`${folder}/types/require.d.ts`]: "declare function require<T = unknown>(path: string): T;\n",
    [`${folder}/pb_hooks/sessions.pb.ts`]: [
      'routerAdd("POST", "/api/sessions/end", (event) => {',
      '  const { endSession } = require<typeof import("./sessions/end-session.js")>(`${__hooks}/sessions/end-session.js`);',
      "  event.json(200, endSession());",
      "});",
      "",
    ].join("\n"),
    [`${folder}/pb_hooks/sessions/end-session.ts`]: POCKETBASE_PROJECT["pocketbase/pb_hooks/sessions/end-session.ts"] ?? "",
    [`${folder}/pb_migrations/001_first_collection.ts`]: "migrate(\n  () => undefined,\n  () => undefined,\n);\n",
  };
}

const LEGACY = "tooling/harness-legacy.json";

/**
 * This template's project with a PocketBase folder at `folder` on the default tool set, ESLint and Prettier, and the
 * template's real tools linked in. `legacy` adds an empty legacy list, so CI judges tool findings file by file. `extra`
 * paths are relative to the git root.
 */
export function pocketbaseEslintRepo(extra: Readonly<Record<string, string>> = {}, { folder = PB, legacy = false } = {}): RepoFixture {
  const config = `export default {
  workspaces: [
    { path: ".", shape: "next-modules", next: true },
    { path: "${folder}", shape: "pocketbase" },
  ],
  root: { entries: ["${folder.split("/")[0] ?? folder}"] },${legacy ? `\n  legacy: "${LEGACY}",` : ""}
};
`;
  const list = legacy ? { [LEGACY]: '{ "version": 1, "files": [] }\n' } : {};
  return templateRepo({ "harness.config.ts": config, ...list, ...eslintFolder(folder), ...extra }, { stack: true });
}
