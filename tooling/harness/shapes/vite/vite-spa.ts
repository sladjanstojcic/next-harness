import { join } from "node:path";
import { checkBackendFolder, GENERATED_TYPES } from "../backend-folder.ts";
import { checkModuleFiles, TEST_FILE, type ModuleLayout } from "../next-modules.ts";
import { deny, exportLine, GENERIC_FOLDERS, onlyGitkeepHidden, PLAIN_SHAPE, ROUTE_SEGMENT, sortedEntries, type PathVerdict, type Shape } from "../shape.ts";
import { ALL_TOOL_CONFIG_NAMES, JS_TOOL_CONFIG_NAMES } from "../tool-config-names.ts";
import { VITE_LAYOUT as LAYOUT, viteContent } from "./content.ts";

const ok: PathVerdict = { ok: true };
/** The config files Vite and TypeScript read; the lock covers them. create-vite writes tsconfig.app.json and tsconfig.node.json. */
export const VITE_CONFIGS = /^(?:vite\.config\.ts|tsconfig(?:\.[\w-]+)?\.json)$/;
const topFolders = ["src", "public", "e2e"];
const topEntries = [
  ...topFolders,
  "index.html",
  "package.json",
  "components.json",
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

const WHERE = `routes belong in src/app/, feature code in src/modules/<module>/, the backend client in src/backend/ and cross-cutting code in src/shared/ ${LAYOUT}`;
const ROUTE_FILES: readonly string[] = ["page.tsx", "layout.tsx", "error.tsx", "not-found.tsx"];
const generic = (folder: string): PathVerdict =>
  deny("generic-folder", `Name the ${folder} subfolder after its area (e.g. pricing/, drafts/); code used across modules belongs in src/shared/lib/ ${LAYOUT}`);
const untested = (file: string): string => file.replace(/\.test(\.tsx?)$/, "$1");

/** A module without the server: no server.ts, server/ or actions/; data/ holds its calls to the backend, and hooks/ is flat. */
const MODULE: ModuleLayout = {
  areaFolders: ["components", "domain", "data"],
  flatFolders: ["hooks"],
  shapeAdvice: `Place module code in components/, domain/, hooks/ or data/; expose it through index.ts, beside types.ts and schemas.ts ${LAYOUT}`,
  nestingAdvice: `Keep hooks/ flat; components/, domain/ and data/ permit one area subfolder. Split a new src/modules/<module>/ for more depth ${LAYOUT}`,
  name: () => deny("file-name", `Use kebab-case names in src/modules/ ${LAYOUT}`),
  generic: (folder) => generic(`${folder}/`),
};

/**
 * One source path per folder and extension the shape allows code in, one per area subfolder level, a colocated test and
 * the fixed names; `{name}` takes a fresh token on each use.
 */
export const VITE_PROBES: readonly string[] = [
  "src/main.tsx",
  "src/app/router.tsx",
  "src/app/page.tsx",
  "src/app/{name}/page.tsx",
  "src/app/[{name}]/page.tsx",
  "src/backend/{name}.ts",
  "src/backend/{name}.test.ts",
  ...["index.ts", "types.ts", "schemas.ts"].map((file) => `src/modules/{name}/${file}`),
  ...["components/{name}.ts", "components/{name}.tsx", "components/{name}/{name}.tsx", "domain/{name}.ts", "domain/{name}/{name}.ts"].map(
    (file) => `src/modules/{name}/${file}`,
  ),
  ...["domain/{name}.test.ts", "hooks/use-{name}.ts", "hooks/use-{name}.tsx", "data/{name}.ts", "data/{name}/{name}.ts"].map(
    (file) => `src/modules/{name}/${file}`,
  ),
  ...["components/{name}.tsx", "components/{name}/{name}.tsx", "lib/{name}.ts", "hooks/{name}.ts"].map((file) => `src/shared/${file}`),
  "e2e/{name}.test.ts",
  "scripts/{name}.ts",
];

/** Next's parameter and group folders mean the same here; its parallel (@slot) and intercepting ((.)x) routes do not exist. */
const isRouteSegment = (part: string): boolean => ROUTE_SEGMENT.test(part) && !part.startsWith("@") && !part.startsWith("(.");

function checkApp(inside: readonly string[]): PathVerdict {
  const file = inside.at(-1) ?? "";
  if (ROUTE_FILES.includes(file) || (inside.length === 1 && file === "router.tsx")) return ok;
  const files = "router.tsx at its top and page.tsx, layout.tsx, error.tsx and not-found.tsx in each route folder";
  return deny("app-file", `src/app/ takes ${files}; move other UI into a module's components/ and import it from the module's index.ts ${LAYOUT}`);
}

function checkModule(parts: readonly string[]): PathVerdict {
  const [, ...inside] = parts;
  if (["server", "actions"].includes(inside[0] ?? "") || (inside.length === 1 && untested(inside[0] ?? "") === "server.ts")) {
    const where = "calls to the backend belong in the module's data/, through the client in src/backend/";
    return deny("module-shape", `This app has no server, so a module has no server.ts, server/ or actions/: ${where} ${LAYOUT}`);
  }
  const verdict = checkModuleFiles(inside, MODULE);
  if (!verdict.ok) return verdict;
  const file = inside.at(-1) ?? "";
  if ((inside[0] === "domain" || inside[0] === "data") && file.endsWith(".tsx"))
    return deny("file-name", `Keep ${inside[0]}/ for TypeScript (.ts); React UI belongs in components/ ${LAYOUT}`);
  if (inside[0] === "hooks" && !/^use-[a-z0-9-]+\.tsx?$/.test(untested(file))) return deny("file-name", `Name hooks use-<name>.ts(x) in hooks/ ${LAYOUT}`);
  return ok;
}

function checkShared(parts: readonly string[]): PathVerdict {
  const folder = parts[0] ?? "";
  if (folder === "ui" && parts.length >= 2) return ok;
  if (!["components", "lib", "hooks"].includes(folder) || parts.length < 2) {
    return deny("shared-shape", `Put shared code in src/shared/components/, lib/ or hooks/; generated primitives belong in src/shared/ui/ ${LAYOUT}`);
  }
  if (parts.length > (folder === "components" ? 3 : 2)) {
    const split = "Move feature code into src/modules/<module>/";
    return deny("nesting", `Keep src/shared/lib/ and hooks/ flat; src/shared/components/ permits one area subfolder. ${split} ${LAYOUT}`);
  }
  return parts.length === 3 && GENERIC_FOLDERS.includes(parts[1] ?? "") ? generic("src/shared/components/") : ok;
}

function checkPath(path: string): PathVerdict {
  const [top, area = "", ...inside] = path.split("/");
  const file = path.split("/").at(-1) ?? "";
  if (top !== "src" || file === ".gitkeep") return ok;
  if (inside.length === 0) {
    if (untested(area) === "main.tsx" || /\.(?:d\.ts|css)$/.test(area)) return ok;
    return deny("src-shape", `src/ takes main.tsx, vite-env.d.ts and CSS files at its top; ${WHERE}`);
  }
  if (area === "assets") return /\.[cm]?[jt]sx?$/.test(file) ? deny("src-shape", `src/assets/ holds images, fonts and CSS; ${WHERE}`) : ok;
  if (area === "app") return checkApp(inside);
  if (area === "modules") return checkModule(inside);
  if (area === "backend") return checkBackendFolder(inside, "src/backend/", LAYOUT);
  if (area === "shared") return checkShared(inside);
  return deny("src-shape", `src/ takes app/, modules/, backend/, shared/ and assets/: ${WHERE}`);
}

function codeIndex(workspaceDir: string): string[] {
  const lines: string[] = [];
  const section = (title: string, base: string, files: readonly string[]): void => {
    const found = files.flatMap((file) => exportLine(join(workspaceDir, base), file) ?? []);
    if (found.length > 0) lines.push("", `## ${title}`, "", ...found);
  };
  const sources = (folder: string): string[] =>
    sortedEntries(join(workspaceDir, folder))
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name))
      .map((entry) => entry.name);
  section("src/backend", "src/backend", sources("src/backend"));
  for (const entry of sortedEntries(join(workspaceDir, "src/modules")).filter((entry) => entry.isDirectory())) {
    section(entry.name, `src/modules/${entry.name}`, ["index.ts"]);
  }
  section("shared/lib", "src/shared/lib", sources("src/shared/lib"));
  return lines;
}

/** A single-page React app built with Vite: it runs wholly in the browser, and talks to a hosted backend through src/backend/ or to none. */
export const viteSpa: Shape = {
  ...PLAIN_SHAPE,
  name: "vite-spa",
  ciAdvice: `Fix application code where it belongs: ${WHERE}`,
  topEntries,
  topEntryPattern: VITE_CONFIGS,
  topFolders,
  topAdvice: `Use an approved entry: application code belongs in src/, static files in public/, browser tests in e2e/, harness code in tooling/ and automation in scripts/ ${LAYOUT}`,
  jsAdvice: `Use TypeScript (.ts/.tsx); only a tool config that cannot be TypeScript may be JavaScript ${LAYOUT}`,
  nameAdvice: `Use kebab-case file and folder names in src/, e2e/, tooling/ and scripts/; [param] and (group) folders belong only in src/app/ ${LAYOUT}`,
  kebabFolders: ["src", "e2e"],
  isNameExempt(parts, index) {
    const part = parts[index] ?? "";
    if (parts[0] !== "src" || index === 0) return false;
    // Fonts and images keep the names they ship with.
    if (part === ".gitkeep" || parts[1] === "assets") return true;
    return parts[1] === "app" && index > 1 && index < parts.length - 1 && isRouteSegment(part);
  },
  jsExceptions: JS_TOOL_CONFIG_NAMES,
  checkHidden: onlyGitkeepHidden(["src"], () => `Keep visible source files in src/; only .gitkeep may be hidden ${LAYOUT}`),
  checkPath,
  vendored: ["src/shared/ui/", "src/shared/lib/utils.ts"],
  vendoredPattern: new RegExp(`^src/backend/[^/]+${GENERATED_TYPES.source}`),
  routeRoot: "src/app/",
  folderGuidance: () =>
    `Use one area subfolder in a module's components/, domain/ or data/, or split a new src/modules/<module>/; keep hooks/, src/backend/ and src/shared/lib/ flat ${LAYOUT}`,
  sameNameScope(path) {
    if (!path.startsWith("src/modules/") || TEST_FILE.test(path)) return undefined;
    const [module, ...inside] = path.slice("src/modules/".length).split("/");
    return inside.length === 0 || (inside.length === 1 && ["index.ts", "types.ts", "schemas.ts"].includes(inside[0] ?? "")) ? undefined : module;
  },
  content: viteContent,
  codeIndex,
};
