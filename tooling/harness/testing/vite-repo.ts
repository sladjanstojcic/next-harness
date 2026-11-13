import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { RepoFixture } from "./temp-repo.ts";
import { consumerRepo } from "./template-repo.ts";

/**
 * A Vite single-page app in the vite-spa shape: a route, one module with components/, domain/ and its test, hooks/ and
 * data/, the PocketBase client in src/backend/ and the validated environment in src/shared/lib/.
 */
const AD_STUDIO = z.record(z.string(), z.string()).parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/ad-studio.json"), "utf8")));

const VITE_CONFIG = 'export default {\n  workspaces: [{ path: ".", shape: "vite-spa" }],\n};\n';
/** The app beside a Supabase folder, as a repository with a hosted backend's migrations holds it. */
const VITE_MONOREPO_CONFIG = `export default {
  workspaces: [
    { path: "apps/web", shape: "vite-spa" },
    { path: "supabase", shape: "supabase" },
  ],
  root: { entries: ["apps", "supabase"] },
};
`;

/** The app at the repository root, with the template's node_modules and the presets as a subtree holds them. */
export function viteProject(): RepoFixture {
  return consumerRepo({ ...AD_STUDIO, "harness.config.ts": VITE_CONFIG });
}

/** The same app in apps/web, beside a supabase workspace, with a root package.json. */
export function viteMonorepo(): RepoFixture {
  const placed = Object.fromEntries(Object.entries(AD_STUDIO).map(([file, text]) => [`apps/web/${file}`, text]));
  return consumerRepo({
    ...placed,
    "package.json": '{\n  "name": "ad-studio-repo",\n  "private": true\n}\n',
    ".gitignore": "node_modules\n",
    "supabase/config.toml": "\n",
    "supabase/migrations/20261101090000_ads.sql": "create table ads (id text primary key);\n",
    "harness.config.ts": VITE_MONOREPO_CONFIG,
  });
}
