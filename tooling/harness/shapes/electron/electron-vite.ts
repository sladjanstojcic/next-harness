import { join } from "node:path";
import { checkModuleFiles, TEST_FILE, type ModuleLayout } from "../next-modules.ts";
import { deny, exportLine, GENERIC_FOLDERS, KEBAB, onlyGitkeepHidden, PLAIN_SHAPE, sortedEntries, type PathVerdict, type Shape } from "../shape.ts";
import { ALL_TOOL_CONFIG_NAMES, JS_TOOL_CONFIG_NAMES } from "../tool-config-names.ts";
import { electronContent } from "./content.ts";
import { ELECTRON_LAYOUT as LAYOUT } from "./source-rules.ts";

const ok: PathVerdict = { ok: true };
const RENDERER = "src/renderer/src/";
/** The config files electron-vite and electron-builder read; the lock covers them and every tsconfig*.json of the workspace. */
export const ELECTRON_CONFIGS = /^(?:electron\.vite\.config\.ts|electron-builder\.(?:ya?ml|json)|dev-app-update\.yml|tsconfig(?:\.[\w-]+)?\.json)$/;
const topFolders = ["src", "build", "resources", "e2e"];
const topEntries = [
  ...topFolders,
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

const WHERE = `main-process code belongs in src/main/<area>/, the bridge in src/preload/, screens in ${RENDERER}modules/<module>/, renderer helpers in ${RENDERER}shared/ and the contract between the three in src/shared/ ${LAYOUT}`;
const name = (): PathVerdict => deny("file-name", `Use kebab-case file and folder names in src/ and e2e/ ${LAYOUT}`);
const generic = (folder: string, shared: string): PathVerdict =>
  deny("generic-folder", `Name the ${folder} subfolder after its area (e.g. storage/, notes/); code used across areas belongs in ${shared} ${LAYOUT}`);
const untested = (file: string): string => file.replace(/\.test(\.tsx?)$/, "$1");

/** A renderer module is a next-modules module without the server: no server.ts, server/ or actions/, and flat hooks/. */
const MODULE: ModuleLayout = {
  areaFolders: ["components", "domain"],
  flatFolders: ["hooks"],
  shapeAdvice: `Place module code in components/, domain/ or hooks/; expose it through index.ts, beside types.ts and schemas.ts ${LAYOUT}`,
  nestingAdvice: `Keep hooks/ flat; components/ and domain/ permit one area subfolder. Split a new ${RENDERER}modules/<module>/ for more depth ${LAYOUT}`,
  name,
  generic: (folder) => generic(`${folder}/`, `${RENDERER}shared/lib/`),
};

/**
 * One source path per folder and extension the shape allows code in, one per area subfolder level, a colocated test and
 * the fixed names; `{name}` takes a fresh token on each use.
 */
export const ELECTRON_PROBES: readonly string[] = [
  "src/main/index.ts",
  "src/main/{name}/{name}.ts",
  "src/main/{name}/{name}.test.ts",
  "src/preload/index.ts",
  "src/preload/{name}.ts",
  "src/shared/{name}.ts",
  "src/shared/{name}/{name}.ts",
  "src/shared/{name}.test.ts",
  ...["main.tsx", "app.tsx"].map((file) => `${RENDERER}${file}`),
  ...["index.ts", "types.ts", "schemas.ts"].map((file) => `${RENDERER}modules/{name}/${file}`),
  ...["components/{name}.ts", "components/{name}.tsx", "components/{name}/{name}.tsx", "domain/{name}.ts", "domain/{name}/{name}.ts"].map(
    (file) => `${RENDERER}modules/{name}/${file}`,
  ),
  ...["domain/{name}.test.ts", "hooks/use-{name}.ts", "hooks/use-{name}.tsx"].map((file) => `${RENDERER}modules/{name}/${file}`),
  ...["components/{name}.tsx", "components/{name}/{name}.tsx", "lib/{name}.ts", "hooks/{name}.ts"].map((file) => `${RENDERER}shared/${file}`),
  "e2e/{name}.test.ts",
  "scripts/{name}.ts",
];

/** Pure TypeScript in a folder that is flat but for one level of area folders: src/main/ and src/shared/. */
function checkAreas(inside: readonly string[], folder: string, flat: boolean, shared: string): PathVerdict {
  const file = inside.at(-1) ?? "";
  if (!file.endsWith(".ts")) return deny("file-name", `Keep ${folder} for TypeScript (.ts); React, CSS and assets belong in src/renderer/ ${LAYOUT}`);
  if (inside.length > 2) return deny("nesting", `${folder} permits one level of area folders; split a second area for more depth ${LAYOUT}`);
  if (inside.length === 2) return GENERIC_FOLDERS.includes(inside[0] ?? "") ? generic(folder, shared) : ok;
  if (flat || untested(file) === "index.ts") return ok;
  return deny("src-shape", `${folder} takes index.ts, the entry; put other code in an area folder such as ${folder}storage/ or ${folder}db/ ${LAYOUT}`);
}

function checkModule(parts: readonly string[]): PathVerdict {
  const [, ...inside] = parts;
  if (["server", "actions"].includes(inside[0] ?? "") || (inside.length === 1 && untested(inside[0] ?? "") === "server.ts")) {
    const where = "Node, the database and the network live in src/main/, and the renderer calls them through the API src/preload/ exposes";
    return deny("module-shape", `A renderer module has no server.ts, server/ or actions/: ${where} ${LAYOUT}`);
  }
  const verdict = checkModuleFiles(inside, MODULE);
  if (!verdict.ok) return verdict;
  const file = inside.at(-1) ?? "";
  if (inside[0] === "domain" && file.endsWith(".tsx"))
    return deny("file-name", `Keep domain/ for pure TypeScript (.ts); React UI belongs in components/ ${LAYOUT}`);
  if (inside[0] === "hooks" && !/^use-[a-z0-9-]+\.tsx?$/.test(untested(file))) return deny("file-name", `Name hooks use-<name>.ts(x) in hooks/ ${LAYOUT}`);
  return ok;
}

function checkRendererShared(parts: readonly string[]): PathVerdict {
  const folder = parts[0] ?? "";
  if (folder === "ui" && parts.length >= 2) return ok;
  if (!["components", "lib", "hooks"].includes(folder) || parts.length < 2) {
    return deny(
      "shared-shape",
      `Put shared renderer code in ${RENDERER}shared/components/, lib/ or hooks/; generated primitives belong in shared/ui/ ${LAYOUT}`,
    );
  }
  if (parts.length > (folder === "components" ? 3 : 2)) {
    const split = `Move feature code into ${RENDERER}modules/<module>/`;
    return deny("nesting", `Keep ${RENDERER}shared/lib/ and hooks/ flat; shared/components/ permits one area subfolder. ${split} ${LAYOUT}`);
  }
  return parts.length === 3 && GENERIC_FOLDERS.includes(parts[1] ?? "") ? generic(`${RENDERER}shared/components/`, `${RENDERER}shared/lib/`) : ok;
}

function checkRenderer(inside: readonly string[]): PathVerdict {
  const file = inside.at(-1) ?? "";
  const top = `src/renderer/ takes index.html and src/; ${WHERE}`;
  if (inside.length === 1) return file.endsWith(".html") ? ok : deny("src-shape", top);
  if (inside[0] !== "src") return deny("src-shape", top);
  const [area, ...rest] = inside.slice(1);
  if (rest.length === 0) {
    if (["main.tsx", "app.tsx"].includes(untested(file)) || /\.(?:d\.ts|css)$/.test(file)) return ok;
    return deny("src-shape", `${RENDERER} takes main.tsx, app.tsx, env.d.ts and CSS files; ${WHERE}`);
  }
  if (area === "assets") {
    return /\.[cm]?[jt]sx?$/.test(file) ? deny("src-shape", `${RENDERER}assets/ holds images, fonts and CSS; ${WHERE}`) : ok;
  }
  if (area === "modules") return checkModule(rest);
  if (area === "shared") return checkRendererShared(rest);
  return deny("src-shape", `Put feature code in ${RENDERER}modules/<module>/ and cross-cutting renderer code in ${RENDERER}shared/; ${WHERE}`);
}

function checkPath(path: string): PathVerdict {
  const [top, area, ...inside] = path.split("/");
  const named = [area ?? "", ...inside];
  if ((top !== "src" && top !== "e2e") || named.at(-1) === ".gitkeep") return ok;
  // Fonts and images keep the names they ship with.
  const assets = path.startsWith(`${RENDERER}assets/`);
  if (!assets && named.some((part) => !KEBAB.test(part.split(".")[0] ?? ""))) return name();
  if (top === "e2e") return ok;
  if (inside.length > 0) {
    if (area === "main") return checkAreas(inside, "src/main/", false, "an area of its own, or src/shared/ when the renderer needs it too");
    if (area === "preload") {
      return inside.length === 1 && inside[0]?.endsWith(".ts") === true
        ? ok
        : deny("nesting", `Keep src/preload/ flat and in TypeScript (.ts): it holds the bridge only; ${WHERE}`);
    }
    if (area === "renderer") return checkRenderer(inside);
    if (area === "shared") return checkAreas(inside, "src/shared/", true, "src/shared/ itself");
  }
  return deny("src-shape", `src/ takes main/, preload/, renderer/ and shared/: ${WHERE}`);
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
  const folders = (folder: string): string[] =>
    sortedEntries(join(workspaceDir, folder))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  const contract = [...sources("src/shared"), ...folders("src/shared").flatMap((area) => sources(`src/shared/${area}`).map((file) => `${area}/${file}`))];
  section("src/shared (the contract between main, preload and renderer)", "src/shared", contract);
  for (const feature of folders(`${RENDERER}modules`)) section(feature, `${RENDERER}modules/${feature}`, ["index.ts"]);
  section("renderer shared/lib", `${RENDERER}shared/lib`, sources(`${RENDERER}shared/lib`));
  return lines;
}

/** An Electron app built with electron-vite: three processes with different powers and the contract between them. */
export const electronVite: Shape = {
  ...PLAIN_SHAPE,
  name: "electron-vite",
  moduleRoot: RENDERER,
  ciAdvice: `Fix application code where it belongs: ${WHERE}`,
  topEntries,
  topEntryPattern: ELECTRON_CONFIGS,
  topFolders,
  topAdvice: `Use an approved entry: application code belongs in src/, packaging assets in build/ and resources/, browser tests in e2e/, harness code in tooling/ and automation in scripts/ ${LAYOUT}`,
  jsAdvice: `Use TypeScript (.ts/.tsx); only a tool config that cannot be TypeScript may be JavaScript ${LAYOUT}`,
  nameAdvice: `Use kebab-case file and folder names in src/, e2e/, tooling/ and scripts/ ${LAYOUT}`,
  jsExceptions: JS_TOOL_CONFIG_NAMES,
  checkHidden: onlyGitkeepHidden(["src"], () => `Keep visible source files in src/; only .gitkeep may be hidden ${LAYOUT}`),
  checkPath,
  vendored: [`${RENDERER}shared/ui/`, `${RENDERER}shared/lib/utils.ts`],
  // No routes here: a file named page.tsx is a component like any other.
  limits: { ...PLAIN_SHAPE.limits, pageLines: Number.POSITIVE_INFINITY },
  folderGuidance: () =>
    `Use one area subfolder (in src/main/, src/shared/, or a module's components/ or domain/), or split a new ${RENDERER}modules/<module>/; keep src/preload/, hooks/ and shared/lib/ flat ${LAYOUT}`,
  sameNameScope(path) {
    if (!path.startsWith(`${RENDERER}modules/`) || TEST_FILE.test(path)) return undefined;
    const [feature, ...inside] = path.slice(`${RENDERER}modules/`.length).split("/");
    return inside.length === 0 || (inside.length === 1 && ["index.ts", "types.ts", "schemas.ts"].includes(inside[0] ?? "")) ? undefined : feature;
  },
  content: electronContent,
  codeIndex,
};
