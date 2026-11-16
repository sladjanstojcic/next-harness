import { checkBackendFolder, GENERATED_TYPES } from "../backend-folder.ts";
import { checkModuleFiles, TEST_FILE, type ModuleLayout } from "../next-modules.ts";
import { backendModulesIndex, deny, KEBAB, onlyGitkeepHidden, PLAIN_SHAPE, type PathVerdict, type Shape } from "../shape.ts";
import { ALL_TOOL_CONFIG_NAMES, JS_TOOL_CONFIG_NAMES, OWN_VITEST_CONFIG } from "../tool-config-names.ts";
import { nodeContent } from "./content.ts";
import { NODE_LAYOUT as LAYOUT } from "./source-rules.ts";

const ok: PathVerdict = { ok: true };
/** The tsconfig files tsc reads; the lock covers them. */
export const NODE_CONFIGS = /^tsconfig(?:\.[\w-]+)?\.json$/;
const TOP_PATTERN = new RegExp(`${NODE_CONFIGS.source}|${OWN_VITEST_CONFIG.source}`);
const topEntries = [
  "src",
  "package.json",
  "Dockerfile",
  "Dockerfile.dockerignore",
  ...ALL_TOOL_CONFIG_NAMES,
  ".dependency-cruiser.json",
  ".jscpd.json",
  ".prettierignore",
  ".env.example",
  "README.md",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
];

const WHERE = `the entry is src/main.ts, the app is built in src/app/app.ts, feature code and its routes.ts belong in src/modules/<module>/, the backend client in src/backend/ and cross-cutting code in src/shared/lib/ ${LAYOUT}`;
/** A colocated unit or integration test (`<name>.test.ts`, `<name>.int.test.ts`) stands for its source file. */
const untested = (file: string): string => file.replace(/(?:\.int)?\.test\.ts$/, ".ts");
const generic = (folder: string): PathVerdict =>
  deny(
    "generic-folder",
    `Name the ${folder}/ subfolder after its area (e.g. pricing/, render/); code used across modules belongs in src/shared/lib/ ${LAYOUT}`,
  );

const MODULE: ModuleLayout = {
  areaFolders: ["domain", "data"],
  flatFolders: [],
  shapeAdvice: `Place module code in domain/ or data/; expose it through index.ts, beside routes.ts, types.ts and schemas.ts ${LAYOUT}`,
  nestingAdvice: `domain/ and data/ permit one area subfolder. Split a new src/modules/<module>/ for more depth ${LAYOUT}`,
  name: () => deny("file-name", `Use kebab-case names in src/modules/ ${LAYOUT}`),
  generic,
};

/** One source path per folder the shape allows code in; `{name}` takes a fresh token on each use. */
export const NODE_PROBES: readonly string[] = [
  "src/main.ts",
  "src/worker.ts",
  "src/app/app.ts",
  "src/backend/{name}.ts",
  ...["index.ts", "routes.ts", "types.ts", "schemas.ts", "domain/{name}.ts", "domain/{name}.test.ts", "domain/{name}/{name}.ts"].map(
    (file) => `src/modules/{name}/${file}`,
  ),
  ...["data/{name}.ts", "data/{name}.int.test.ts", "data/{name}/{name}.ts"].map((file) => `src/modules/{name}/${file}`),
  "src/shared/lib/{name}.ts",
];

function checkModule(parts: readonly string[]): PathVerdict {
  const [module = "", ...inside] = parts;
  if (module === ".gitkeep" && inside.length === 0) return ok;
  if (!KEBAB.test(module)) return MODULE.name();
  const folder = inside[0] ?? "";
  const file = untested(inside.at(-1) ?? "");
  if (["server", "actions"].includes(folder) || (inside.length === 1 && file === "server.ts")) {
    return deny("module-shape", `A module has no server.ts, server/ or actions/: its I/O belongs in data/, its HTTP routes in routes.ts ${LAYOUT}`);
  }
  if (["components", "hooks"].includes(folder)) {
    return deny("module-shape", `A service renders no UI, so a module has no components/ or hooks/: logic belongs in domain/ and data/ ${LAYOUT}`);
  }
  if (inside.length === 1 && file === "routes.ts") return ok;
  return checkModuleFiles(inside, MODULE);
}

function checkSource(path: string): PathVerdict {
  const parts = path.split("/");
  const [top, area = "", ...inside] = parts;
  if (top !== "src" || parts.at(-1) === ".gitkeep") return ok;
  if (inside.length === 0) {
    return ["main.ts", "worker.ts"].includes(untested(area)) ? ok : deny("src-shape", `src/ takes main.ts and an optional worker.ts at its top; ${WHERE}`);
  }
  if (area === "app") {
    if (inside.length === 1 && untested(inside[0] ?? "") === "app.ts") return ok;
    return deny("app-file", `src/app/ takes app.ts and its test only: each module's routes belong in its routes.ts, mounted in app.ts ${LAYOUT}`);
  }
  if (area === "modules") return checkModule(inside);
  // An integration test of the client is judged as the client's own name.
  if (area === "backend") return checkBackendFolder([...inside.slice(0, -1), untested(inside.at(-1) ?? "")], "src/backend/", LAYOUT);
  if (area === "shared") {
    if (inside[0] !== "lib" || inside.length < 2) return deny("shared-shape", `Put shared code in src/shared/lib/; a service has no shared UI ${LAYOUT}`);
    if (inside.length > 2) return deny("nesting", `Keep src/shared/lib/ flat; move feature code into src/modules/<module>/ ${LAYOUT}`);
    return ok;
  }
  return deny("src-shape", `src/ takes main.ts, worker.ts, app/, modules/, backend/ and shared/: ${WHERE}`);
}

/** The folder rules first, so a component is sent out of the module; then a .tsx file anywhere else. */
function checkPath(path: string): PathVerdict {
  const verdict = checkSource(path);
  if (!verdict.ok || !path.endsWith(".tsx")) return verdict;
  return deny("file-name", `A service renders no UI: use .ts files; ${WHERE}`);
}

/** A long-running Node HTTP service that runs its TypeScript source directly: no UI, no build, one entry in src/main.ts. */
export const nodeService: Shape = {
  ...PLAIN_SHAPE,
  name: "node-service",
  ciAdvice: `Fix service code where it belongs: ${WHERE}`,
  topEntries,
  topEntryPattern: TOP_PATTERN,
  topFolders: ["src"],
  topAdvice: `Use an approved entry: service code belongs in src/; the top takes package.json, the tsconfig files, the tool configs, Dockerfile and Dockerfile.dockerignore ${LAYOUT}`,
  jsAdvice: `Use TypeScript (.ts); only a tool config that cannot be TypeScript may be JavaScript ${LAYOUT}`,
  nameAdvice: `Use kebab-case file and folder names in src/, tooling/ and scripts/ ${LAYOUT}`,
  kebabFolders: ["src"],
  isNameExempt: (parts, index) => parts[index] === ".gitkeep",
  jsExceptions: JS_TOOL_CONFIG_NAMES,
  checkHidden: onlyGitkeepHidden(["src"], () => `Keep visible source files in src/; only .gitkeep may be hidden ${LAYOUT}`),
  checkPath,
  vendoredPattern: new RegExp(`^src/backend/[^/]+${GENERATED_TYPES.source}`),
  folderGuidance: () =>
    `Use one area subfolder in a module's domain/ or data/, or split a new src/modules/<module>/; keep src/backend/ and src/shared/lib/ flat ${LAYOUT}`,
  sameNameScope(path) {
    if (!path.startsWith("src/modules/") || TEST_FILE.test(path)) return undefined;
    const [module, ...inside] = path.slice("src/modules/".length).split("/");
    return inside.length <= 1 ? undefined : module;
  },
  content: nodeContent,
  codeIndex: backendModulesIndex,
};
