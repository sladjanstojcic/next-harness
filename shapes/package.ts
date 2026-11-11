import { checkModuleFiles, MODULE_ENTRIES, type ModuleLayout } from "./next-modules.ts";
import { deny, exportLine, KEBAB, onlyGitkeepHidden, PLAIN_SHAPE, type ContentProfile, type PathVerdict, type Shape } from "./shape.ts";
import { ALL_TOOL_CONFIG_NAMES, JS_TOOL_CONFIG_NAMES } from "./tool-config-names.ts";

const LAYOUT = "(package layout)";
const ok: PathVerdict = { ok: true };
const areaFolders = ["components", "server", "domain"];
const flatFolders = ["hooks", "lib"];
const topEntries = ["src", "package.json", "tsconfig.json", "README.md", "AGENTS.md", "CLAUDE.md", ...ALL_TOOL_CONFIG_NAMES, ".prettierignore", ".gitignore"];

const ACTIONS_ADVICE = `Server Actions live in an app's module (under apps/<app>/, in modules/<module>/actions/<name>-action.ts) and call this package's server.ts; a package holds no actions/ and no "use server" ${LAYOUT}`;

/** A package is one module of the app, moved: the same folders without actions/, plus flat hooks/ and lib/. */
const PACKAGE_LAYOUT: ModuleLayout = {
  areaFolders,
  flatFolders,
  shapeAdvice: `Place package code in src/components/, server/, domain/, hooks/ or lib/; expose it through src/index.ts or src/server.ts ${LAYOUT}`,
  nestingAdvice: `Keep src/hooks/ and src/lib/ flat; src/components/, server/ and domain/ permit one area subfolder. Split a second package for more depth ${LAYOUT}`,
  name: () => deny("file-name", `Use kebab-case file and folder names in src/ ${LAYOUT}`),
  generic: (folder) =>
    deny(
      "generic-folder",
      `Name the src/${folder}/ subfolder after its area (e.g. pricing/, documents/); helpers shared across the package belong in src/lib/ ${LAYOUT}`,
    ),
};

/**
 * One source path per folder and extension the shape allows code in, one per area subfolder level, a colocated test and
 * the entry files; `{name}` takes a fresh token on each use.
 */
export const PACKAGE_PROBES: readonly string[] = [
  "src/components/{name}.ts",
  "src/components/{name}.tsx",
  ...areaFolders.filter((folder) => folder !== "components").map((folder) => `src/${folder}/{name}.ts`),
  ...areaFolders.map((folder) => `src/${folder}/{name}/{name}.${folder === "components" ? "tsx" : "ts"}`),
  "src/domain/{name}.test.ts",
  "src/hooks/use-{name}.ts",
  "src/hooks/use-{name}.tsx",
  "src/lib/{name}.ts",
  ...MODULE_ENTRIES.map((file) => `src/${file}`),
];

function checkPath(path: string): PathVerdict {
  const [top, ...inside] = path.split("/");
  const name = inside.at(-1) ?? "";
  if (top !== "src" || inside.length === 0 || name === ".gitkeep") return ok;
  if (inside.some((part) => !KEBAB.test(part.split(".")[0] ?? ""))) return PACKAGE_LAYOUT.name();
  if (inside[0] === "actions") return deny("module-shape", ACTIONS_ADVICE);
  const verdict = checkModuleFiles(inside, PACKAGE_LAYOUT);
  if (!verdict.ok) return verdict;
  if (inside[0] === "domain" && name.endsWith(".tsx")) {
    return deny("file-name", `Keep src/domain/ for pure TypeScript (.ts); React UI belongs in src/components/ ${LAYOUT}`);
  }
  if (inside[0] === "hooks" && !/^use-[a-z0-9-]+\.tsx?$/.test(name.replace(/\.test(\.tsx?)$/, "$1"))) {
    return deny("file-name", `Name hooks use-<name>.ts(x) in src/hooks/ ${LAYOUT}`);
  }
  return ok;
}

const content: ContentProfile = {
  noActions: true,
  actionBuilders: [],
  serverFile: /^src\/server(?:\.ts$|\/)/,
  clientFile: /^src\/(?:components|hooks)\//,
  publicIndex: /^src\/index\.ts$/,
  aliases: {},
  envScope: /^src\//,
  domainFile: /^src\/domain\/(?:[^/]+\/)?[^/]+\.ts$/,
  packageBoundary: `Keep relative imports inside src/: import another package by its name through its package.json exports, and keep code out of the package's top level ${LAYOUT}`,
  sourceRoot: "src/",
  messages: {
    serverOnly: `Import "server-only" in src/server.ts and src/server/ files; client-safe code belongs in src/components/, domain/ or lib/ ${LAYOUT}`,
    useServer: ACTIONS_ADVICE,
    useClient: `Put "use client" in src/components/ or src/hooks/ ${LAYOUT}`,
    clientImportsServer: `Client files may not import src/server.ts or src/server/; pass server data in as props from the app ${LAYOUT}`,
    indexExports: `Keep src/index.ts client-safe: expose queries and server components through src/server.ts ${LAYOUT}`,
    thinPage: `page.tsx has {count} lines (maximum {max}); routes belong in the app's src/app/ ${LAYOUT}`,
    domainTest: `Put the domain rule's test beside it at {test} ${LAYOUT}`,
    envAccess: `Read environment variables in the app's src/shared/lib/env.ts and pass the value into the package ${LAYOUT}`,
    errorText: `Throw a typed error and let the app turn it into user-facing text ${LAYOUT}`,
  },
};

export const packageShape: Shape = {
  ...PLAIN_SHAPE,
  name: "package",
  ciAdvice: `Fix package code in src/components/, server/, domain/, hooks/ or lib/ ${LAYOUT}`,
  topEntries,
  topEntryPattern: /^[^.].*\.(?:json|md)$/,
  topFolders: ["src"],
  topAdvice: `Keep TypeScript source under src/; a package's top level takes package.json, tsconfig.json, the tool configs and .json or .md files, no JavaScript and no folder but src/ ${LAYOUT}`,
  jsAdvice: `Use TypeScript (.ts/.tsx); a package holds no JavaScript but the tool configs that cannot be TypeScript ${LAYOUT}`,
  jsExceptions: JS_TOOL_CONFIG_NAMES,
  checkHidden: onlyGitkeepHidden(["src"], () => `Keep visible source files in src/; only .gitkeep may be hidden ${LAYOUT}`),
  checkPath,
  folderGuidance: () => `Use one area subfolder in src/components/, server/ or domain/, or split a second package; keep src/hooks/ and src/lib/ flat ${LAYOUT}`,
  content,
  codeIndex(workspaceDir) {
    const lines = ["src/index.ts", "src/server.ts"].flatMap((file) => exportLine(workspaceDir, file) ?? []);
    return lines.length === 0 ? [] : ["", ...lines];
  },
};
