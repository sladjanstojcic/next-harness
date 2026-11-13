import { join } from "node:path";
import { BESIDE_APP, SOURCE_AREAS, type SourceRoot } from "../config.ts";
import { backendProfile, checkBackendFolder, GENERATED_TYPES } from "./backend-folder.ts";
import { MAX_FILE_LINES, MAX_FOLDER_FILES, MAX_PAGE_LINES } from "./limits.ts";
import {
  deny,
  exportLine,
  GENERIC_FOLDERS,
  INTERCEPTING_SEGMENT,
  isNextSpecialFile,
  KEBAB,
  nameDenial,
  ROUTE_SEGMENT,
  sortedEntries,
  TEST_FILE,
  type ContentProfile,
  type PathVerdict,
  type Shape,
} from "./shape.ts";
import { ALL_TOOL_CONFIG_NAMES, JS_TOOL_CONFIG_NAMES } from "./tool-config-names.ts";

export { TEST_FILE } from "./shape.ts";
export const MODULE_ENTRIES: readonly string[] = ["index.ts", "server.ts", "schemas.ts", "types.ts"];

const ok: PathVerdict = { ok: true };
const CONFIG_ENTRIES = ["package.json", "tsconfig.json", "next-env.d.ts", "next.config.ts", ...ALL_TOOL_CONFIG_NAMES];
const DOT_ENTRIES = ["components.json", ".dependency-cruiser.json", ".jscpd.json", ".prettierignore", ".env.example"];
/** An app below the repository root has its own; at the root the root layout already takes them. */
const APP_ENTRIES = ["README.md", ".gitignore", "AGENTS.md", "CLAUDE.md"];
export const MODULE_FOLDERS: readonly string[] = ["components", "server", "actions", "domain"];
export const SHARED_FOLDERS: readonly string[] = ["components", "lib", "hooks"];

function genericDenial(root: SourceRoot, folder: string): PathVerdict {
  return deny(
    "generic-folder",
    `Name the ${folder}/ subfolder after its area (e.g. pricing/, documents/); code shared across modules belongs in ${root}shared/lib/.`,
  );
}

function checkApp(parts: string[], root: SourceRoot): PathVerdict {
  const file = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((part) => !KEBAB.test(part) && !ROUTE_SEGMENT.test(part) && !INTERCEPTING_SEGMENT.test(part))) return nameDenial(root);
  if (isNextSpecialFile(file, parts.length === 1)) return ok;
  return deny("app-file", "move it into a module's components/ and import it from the module's index.ts");
}

/** Where a module keeps its code, and the words of each denial: an app's module and a shared package share the rule, not the text. */
export interface ModuleLayout {
  areaFolders: readonly string[];
  flatFolders: readonly string[];
  shapeAdvice: string;
  nestingAdvice: string;
  name(): PathVerdict;
  generic(folder: string): PathVerdict;
}

/** One module's files, relative to its folder: the entry files, then code in the layout's folders with at most one area subfolder. */
export function checkModuleFiles(inside: readonly string[], layout: ModuleLayout): PathVerdict {
  const file = (inside.at(-1) ?? "").replace(TEST_FILE, ".ts");
  if (inside.length === 1 && MODULE_ENTRIES.includes(file)) return ok;
  const folder = inside[0] ?? "";
  const flat = layout.flatFolders.includes(folder);
  if ((!flat && !layout.areaFolders.includes(folder)) || inside.length < 2) return deny("module-shape", layout.shapeAdvice);
  if (inside.length > (flat ? 2 : 3)) return deny("nesting", layout.nestingAdvice);
  if (inside.slice(0, -1).some((part) => !KEBAB.test(part))) return layout.name();
  if (inside.length === 3 && GENERIC_FOLDERS.includes(inside[1] ?? "")) return layout.generic(folder);
  return ok;
}

const untested = (file: string): string => file.replace(/\.test(\.tsx?)$/, "$1");

/** The denials of a module in an app without a server; each shape words them with its own paths and layout. */
export interface ClientModuleText {
  noServer: string;
  /** The folders that take TypeScript without JSX, and the denial of a .tsx file there. */
  tsOnly: readonly string[];
  noJsx(folder: string): string;
  layout: string;
}

/** A module of an app without a server: no server.ts, server/ or actions/, no JSX outside UI folders, and hooks named use-<name>.ts(x). */
export function checkClientModule(inside: readonly string[], layout: ModuleLayout, text: ClientModuleText): PathVerdict {
  const folder = inside[0] ?? "";
  if (["server", "actions"].includes(folder) || (inside.length === 1 && untested(folder) === "server.ts")) return deny("module-shape", text.noServer);
  const verdict = checkModuleFiles(inside, layout);
  if (!verdict.ok) return verdict;
  const file = untested(inside.at(-1) ?? "");
  if (text.tsOnly.includes(folder) && file.endsWith(".tsx")) return deny("file-name", text.noJsx(folder));
  if (folder === "hooks" && !/^use-[a-z0-9-]+\.tsx?$/.test(file)) return deny("file-name", `Name hooks use-<name>.ts(x) in hooks/ ${text.layout}`);
  return ok;
}

function checkModule(parts: string[], root: SourceRoot): PathVerdict {
  if (parts.length === 1 && parts[0] === ".gitkeep") return ok;
  const [module, ...inside] = parts;
  if (module && !KEBAB.test(module)) return nameDenial(root);
  const verdict = checkModuleFiles(inside, {
    areaFolders: MODULE_FOLDERS.filter((folder) => folder !== "actions"),
    flatFolders: ["actions"],
    shapeAdvice: "Place module code in components/, server/, actions/ or domain/; expose it through index.ts, server.ts or actions/<name>-action.ts.",
    nestingAdvice: `Keep actions/ flat; components/, server/ and domain/ permit one area subfolder. Split a new ${root}modules/<module>/ for more depth.`,
    name: () => nameDenial(root),
    generic: (folder) => genericDenial(root, folder),
  });
  if (!verdict.ok) return verdict;
  if (inside[0] === "actions" && !/^[a-z0-9]+(?:-[a-z0-9]+)*-action\.ts$/.test((inside.at(-1) ?? "").replace(TEST_FILE, ".ts"))) {
    return deny("module-shape", "Put Server Actions in actions/<kebab>-action.ts and their tests beside them as <kebab>-action.test.ts(x).");
  }
  return ok;
}

function checkShared(parts: string[], root: SourceRoot): PathVerdict {
  const folder = parts[0];
  if (folder === "ui" && parts.length >= 2) return ok;
  if (!folder || !SHARED_FOLDERS.includes(folder) || parts.length < 2) {
    return deny("shared-shape", `Put shared code in ${root}shared/components/, lib/ or hooks/; generated primitives belong in ${root}shared/ui/.`);
  }
  if (parts.length > (folder === "components" ? 3 : 2)) {
    return deny(
      "nesting",
      `Keep ${root}shared/lib/ and hooks/ flat; ${root}shared/components/ permits one area subfolder. Move feature code into ${root}modules/<module>/.`,
    );
  }
  if (parts.slice(0, -1).some((part) => !KEBAB.test(part))) return nameDenial(root);
  if (folder === "components" && parts.length === 3 && GENERIC_FOLDERS.includes(parts[1] ?? "")) return genericDenial(root, `${root}shared/components`);
  return ok;
}

function content(root: SourceRoot): ContentProfile {
  const under = (pattern: string): RegExp => new RegExp(`^${root}${pattern}`);
  const envScope = root === "" ? /^(?:(?:app|modules|shared|backend)\/|(?:proxy|instrumentation(?:-client)?)\.ts$)/ : /^src\//;
  return {
    actionFile: under("modules/[^/]+/actions/[^/]+-action\\.ts$"),
    actionBuilders: ["defineAction"],
    serverFile: under("modules/[^/]+/server(?:\\.ts$|/)"),
    clientFile: under("(?:modules/[^/]+/components/|shared/(?:components|ui|hooks)/|app/(?:.*/)?error\\.tsx$|app/global-error\\.tsx$)"),
    publicIndex: under("modules/[^/]+/index\\.ts$"),
    actionImport: under("modules/[^/]+/actions(?:/|$)"),
    aliases: { "@/": root },
    envFile: `${root}shared/lib/env.ts`,
    envScope,
    backend: backendProfile(envScope, under("backend/"), `${root}backend/`, ""),
    domainFile: under("modules/[^/]+/domain/(?:[^/]+/)?[^/]+\\.ts$"),
    errorScope: new RegExp(`^${root}app/|(?:^|/)components/`),
    messages: {
      serverOnly: 'Import "server-only" in module server.ts and server/ files; client-safe code belongs in components/ or index.ts.',
      useServer: `Put "use server" first in ${root}modules/<module>/actions/<name>-action.ts and call defineAction from ${root}shared/lib/define-action.ts.`,
      useClient: `Put "use client" in module components/, shared components/ui/hooks, or ${root}app error.tsx and global-error.tsx.`,
      clientImportsServer: "Import client-safe code through a module's index.ts or actions/<name>-action.ts; server.ts and server/ belong on the server.",
      indexExports: "Keep index.ts client-safe: expose queries through server.ts and import mutations directly from actions/<name>-action.ts.",
      thinPage: `page.tsx has {count} lines (maximum {max}); move UI into ${root}modules/<module>/components/ and import it through index.ts.`,
      domainTest: "Put the domain rule's test beside it at {test}.",
      envAccess: `Read and validate environment variables in ${root}shared/lib/env.ts; import its typed env value here.`,
      errorText: `Use UserError and user-facing error helpers from ${root}shared/lib/user-error.ts; keep raw error details in ${root}shared/lib/log.ts.`,
    },
  };
}

function codeIndex(workspaceDir: string, root: SourceRoot): string[] {
  const lines: string[] = [];
  const append = (base: string, file: string): void => {
    const line = exportLine(base, file);
    if (line !== undefined) lines.push(line);
  };
  const modules = join(workspaceDir, `${root}modules`);
  for (const entry of sortedEntries(modules).filter((entry) => entry.isDirectory())) {
    lines.push("", `## ${entry.name}`, "");
    const base = join(modules, entry.name);
    append(base, "index.ts");
    append(base, "server.ts");
    for (const action of sortedEntries(join(base, "actions")).filter((entry) => entry.isFile() && entry.name.endsWith("-action.ts"))) {
      append(base, `actions/${action.name}`);
    }
  }
  lines.push("", "## shared/lib", "");
  const shared = join(workspaceDir, `${root}shared/lib`);
  for (const entry of sortedEntries(shared).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name))) {
    append(shared, entry.name);
  }
  return lines;
}

const ROOT_LAYOUT_ADVICE =
  "Use an approved root entry: routes belong in app/, feature code in modules/<module>/, shared code in shared/, harness code in tooling/, and automation in scripts/; this project keeps its code beside app/, not in src/.";

/** The shape for one source root. With "" the three areas and the files beside app/ are top entries, and `src` is not one. */
function nextModulesShape(root: SourceRoot): Shape {
  const sources = root === "" ? SOURCE_AREAS : ["src"];
  const depth = root === "" ? 0 : 1;
  const topFolders = [...sources, "e2e", "public"];
  const inSource = (parts: readonly string[]): boolean => sources.includes(parts[0] ?? "");
  return {
    name: "next-modules",
    ...(root === "" ? { sourceRoot: root, topAdvice: ROOT_LAYOUT_ADVICE } : {}),
    ciAdvice: `Fix application code in ${root}modules/ or ${root}shared/; harness code belongs in tooling/harness/ and automation in scripts/.`,
    topEntries: [...topFolders, ...(root === "" ? BESIDE_APP : []), ...CONFIG_ENTRIES, ...DOT_ENTRIES, ...APP_ENTRIES],
    topFolders,
    kebabFolders: [...sources, "e2e"],
    checkHidden(path) {
      const parts = path.split("/");
      if (inSource(parts) && parts.slice(1).some((part) => part.startsWith(".") && part !== ".gitkeep")) {
        const where = root === "" ? "app/, modules/ or shared/" : "src/";
        return deny("hidden-file", `Keep visible source files in ${root}modules/ or ${root}shared/; only .gitkeep placeholders may be hidden under ${where}.`);
      }
      return ok;
    },
    isNameExempt(parts, index) {
      const part = parts[index] ?? "";
      if (!inSource(parts)) return false;
      if (part === ".gitkeep") return true;
      return parts[depth] === "app" && index > depth && index < parts.length - 1 && (ROUTE_SEGMENT.test(part) || INTERCEPTING_SEGMENT.test(part));
    },
    checkPath(path) {
      const parts = path.split("/");
      if (!inSource(parts)) return ok;
      const [area, ...rest] = parts.slice(depth);
      if (rest.length === 0 && BESIDE_APP.includes(area ?? "")) return ok;
      if (rest.length > 0) {
        if (area === "app") return checkApp(rest, root);
        if (area === "modules") return checkModule(rest, root);
        if (area === "shared") return checkShared(rest, root);
        if (area === "backend") return checkBackendFolder(rest, `${root}backend/`, "");
      }
      return deny("src-shape", `Put routes in ${root}app/, feature code in ${root}modules/<module>/, and cross-cutting utilities in ${root}shared/lib/.`);
    },
    vendored: [`${root}shared/ui/`, `${root}shared/lib/utils.ts`],
    vendoredPattern: new RegExp(`^${root}backend/[^/]+${GENERATED_TYPES.source}`),
    jsExceptions: JS_TOOL_CONFIG_NAMES,
    routeRoot: `${root}app/`,
    limits: { fileLines: MAX_FILE_LINES, folderFiles: MAX_FOLDER_FILES, pageLines: MAX_PAGE_LINES },
    folderGuidance: () =>
      `Use one area subfolder in components/, server/ or domain/, or split feature code into a new ${root}modules/<module>/; keep actions/, lib/ and hooks/ flat.`,
    sameNameScope(path) {
      const parts = path.split("/");
      const [area, module] = parts.slice(depth);
      if (!inSource(parts) || area !== "modules" || !module || parts.length < depth + 3 || TEST_FILE.test(path)) return undefined;
      return MODULE_ENTRIES.includes(parts.at(-1) ?? "") ? undefined : module;
    },
    content: content(root),
    codeIndex: (workspaceDir) => codeIndex(workspaceDir, root),
  };
}

export const nextModules: Shape = nextModulesShape("src/");
/** create-next-app without --src-dir and create-turbo: app/, modules/ and shared/ at the workspace top. */
export const nextModulesAtRoot: Shape = nextModulesShape("");
