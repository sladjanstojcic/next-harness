import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { RepoFixture } from "./temp-repo.ts";
import { consumerRepo } from "./template-repo.ts";

/**
 * A Node service in the node-service shape: the entry, the app that mounts one module's routes, the module's domain/
 * with its test and data/, the Supabase client in src/backend/ and the validated environment in src/shared/lib/.
 */
const AD_API = z.record(z.string(), z.string()).parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/ad-api.json"), "utf8")));

/** The service at the repository root. */
export function nodeProject(): RepoFixture {
  return consumerRepo({ ...AD_API, "harness.config.ts": 'export default {\n  workspaces: [{ path: ".", shape: "node-service" }],\n};\n' }, "", {
    agents: true,
  });
}

/** The same service in apps/api, beside a shared package, as a Turborepo monorepo holds it. */
export function nodeMonorepo(): RepoFixture {
  const placed = Object.fromEntries(Object.entries(AD_API).map(([file, text]) => [`apps/api/${file}`, text]));
  const config = `export default {
  workspaces: [
    { path: "apps/api", shape: "node-service" },
    { path: "packages/*", shape: "package" },
  ],
  root: { entries: ["apps", "packages"] },
};
`;
  return consumerRepo(
    {
      ...placed,
      "package.json": '{\n  "name": "ad-repo",\n  "private": true\n}\n',
      ".gitignore": "node_modules\n",
      "packages/doc/package.json": '{\n  "name": "@acme/doc",\n  "private": true,\n  "type": "module",\n  "exports": { ".": "./src/index.ts" }\n}\n',
      "packages/doc/src/index.ts": "export const size = 1080;\n",
      "harness.config.ts": config,
    },
    "",
    { agents: true },
  );
}
