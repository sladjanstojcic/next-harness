import type { SourceRoot } from "../config.ts";
import { MODULE_ENTRIES, MODULE_FOLDERS, SHARED_FOLDERS } from "./next-modules.ts";

/** The shared/lib/ helpers the content rules point at, which `init --starter` copies. */
export const STARTER_HELPERS: readonly string[] = ["env.ts", "define-action.ts", "user-error.ts", "format.ts", "log.ts"];

/**
 * One source path per folder and extension this shape allows code in, one per area subfolder level, a colocated test
 * and an automation script, then the fixed names and route segments a config could single out; `{name}` takes a fresh
 * token on each use. Written for the src/ layout; `sourceProbes` gives them for a workspace's own source root.
 */
export const SOURCE_PROBES: readonly string[] = [
  "src/app/{name}/{name}.ts",
  "src/app/{name}/{name}.tsx",
  "src/modules/{name}/{name}.ts",
  ...MODULE_FOLDERS.flatMap((folder) => {
    if (folder === "components") return ["src/modules/{name}/components/{name}.ts", "src/modules/{name}/components/{name}.tsx"];
    if (folder === "actions") return ["src/modules/{name}/actions/{name}-action.ts"];
    return [`src/modules/{name}/${folder}/{name}.ts`];
  }),
  ...MODULE_FOLDERS.filter((folder) => folder !== "actions").map(
    (folder) => `src/modules/{name}/${folder}/{name}/{name}.${folder === "components" ? "tsx" : "ts"}`,
  ),
  "src/modules/{name}/domain/{name}.test.ts",
  ...SHARED_FOLDERS.map((folder) => `src/shared/${folder}/{name}.${folder === "components" ? "tsx" : "ts"}`),
  "src/backend/{name}.ts",
  "scripts/{name}.ts",
  ...["page.tsx", "layout.tsx", "route.ts"].map((file) => `src/app/{name}/${file}`),
  "src/app/{name}/{name}/page.tsx",
  "src/app/({name})/{name}/page.tsx",
  "src/app/[{name}]/page.tsx",
  ...MODULE_ENTRIES.map((file) => `src/modules/{name}/${file}`),
  ...STARTER_HELPERS.map((file) => `src/shared/lib/${file}`),
];

export const sourceProbes = (root: SourceRoot): string[] => SOURCE_PROBES.map((probe) => probe.replace(/^src\//, root));
