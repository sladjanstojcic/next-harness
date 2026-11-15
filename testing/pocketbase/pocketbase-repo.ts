import { makeRepo, type RepoFixture } from "../temp-repo.ts";

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
