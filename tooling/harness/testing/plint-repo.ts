import { makeRepo, type RepoFixture } from "./temp-repo.ts";

export const PLINT_LEGACY = "tooling/harness-legacy.json";
export const PLINT_LEGACY_FILES = ["apps/dashboard/src/utils/format-date.ts", "apps/dashboard/src/components/UsageChart.tsx"] as const;
export const PLINT_MIGRATION = "supabase/migrations/20261101090000_api_schema.sql";

const CONFIG = `export default {
  workspaces: [
    { path: "apps/dashboard", shape: "next-modules", next: true, tools: "eslint-prettier" },
    { path: "supabase", shape: "supabase" },
  ],
  root: { entries: ["apps", "supabase", "turbo.json"] },
  legacy: "${PLINT_LEGACY}",
};
`;

/** plint-control-plane in miniature: a next-modules dashboard under apps/, Supabase at the root, and a committed legacy list for two dashboard files. */
export function plintRepo(files: Record<string, string> = {}): RepoFixture {
  return makeRepo({
    "harness.config.ts": CONFIG,
    ".gitignore": "node_modules/\n",
    "package.json": "{}\n",
    "turbo.json": "{}\n",
    [PLINT_LEGACY]: `${JSON.stringify({ version: 1, files: PLINT_LEGACY_FILES }, null, 2)}\n`,
    "apps/dashboard/package.json": "{}\n",
    "apps/dashboard/tsconfig.json": "{}\n",
    "apps/dashboard/src/app/layout.tsx": "export default function Layout() { return null; }\n",
    "apps/dashboard/src/app/page.tsx": "export default function Page() { return null; }\n",
    "apps/dashboard/src/modules/usage/index.ts": "export type Usage = { calls: number };\n",
    [PLINT_LEGACY_FILES[0]]: "export const formatDate = (value: Date) => value.toISOString();\n",
    [PLINT_LEGACY_FILES[1]]: "export function UsageChart() { return null; }\n",
    "supabase/config.toml": "\n",
    [PLINT_MIGRATION]: "create schema api;\n",
    "node_modules/.bin/eslint": "",
    "node_modules/.bin/prettier": "",
    "node_modules/.bin/tsc": "",
    "apps/dashboard/node_modules/.bin/next": "",
    ...files,
  });
}
