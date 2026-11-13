import { makeRepo, type RepoFixture } from "./temp-repo.ts";

export const DASHBOARD_LEGACY = "tooling/harness-legacy.json";
export const DASHBOARD_LEGACY_FILES = ["apps/dashboard/src/utils/format-date.ts", "apps/dashboard/src/components/UsageChart.tsx"] as const;
export const DASHBOARD_MIGRATION = "supabase/migrations/20261101090000_api_schema.sql";

const CONFIG = `export default {
  workspaces: [
    { path: "apps/dashboard", shape: "next-modules", next: true, tools: "eslint-prettier" },
    { path: "supabase", shape: "supabase" },
  ],
  root: { entries: ["apps", "supabase", "turbo.json"] },
  legacy: "${DASHBOARD_LEGACY}",
};
`;

const DASHBOARD_FILES: Readonly<Record<string, string>> = {
  "harness.config.ts": CONFIG,
  ".gitignore": "node_modules/\n",
  "package.json": "{}\n",
  "turbo.json": "{}\n",
  [DASHBOARD_LEGACY]: `${JSON.stringify({ version: 1, files: DASHBOARD_LEGACY_FILES }, null, 2)}\n`,
  "apps/dashboard/package.json": "{}\n",
  "apps/dashboard/tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
  "apps/dashboard/src/app/layout.tsx": "export default function Layout() { return null; }\n",
  "apps/dashboard/src/app/page.tsx": "export default function Page() { return null; }\n",
  "apps/dashboard/src/modules/usage/index.ts": "export type Usage = { calls: number };\n",
  [DASHBOARD_LEGACY_FILES[0]]: "export const formatDate = (value: Date) => value.toISOString();\n",
  [DASHBOARD_LEGACY_FILES[1]]: "export function UsageChart() { return null; }\n",
  "supabase/config.toml": "\n",
  [DASHBOARD_MIGRATION]: "create schema api;\n",
  "node_modules/.bin/eslint": "",
  "node_modules/.bin/prettier": "",
  "node_modules/.bin/tsc": "",
  "node_modules/.bin/depcruise": "",
  "node_modules/.bin/knip": "",
  "node_modules/.bin/jscpd": "",
  "apps/dashboard/node_modules/.bin/next": "",
};

/** A dashboard monorepo in miniature: a next-modules dashboard under apps/, Supabase at the root, and a committed legacy list for two dashboard files. */
export function dashboardRepo(files: Record<string, string> = {}): RepoFixture {
  return makeRepo({ ...DASHBOARD_FILES, ...files }, { agents: true, stack: true });
}

/** The same project as create-turbo writes the app: app/ at the dashboard's top, its old lib and components beside it, no src/. */
export function dashboardRepoWithoutSrc(files: Record<string, string> = {}): RepoFixture {
  const atTop = (text: string): string => text.replaceAll("apps/dashboard/src/", "apps/dashboard/");
  return makeRepo(
    { ...Object.fromEntries(Object.entries(DASHBOARD_FILES).map(([file, text]) => [atTop(file), atTop(text)])), ...files },
    { agents: true, stack: true },
  );
}
