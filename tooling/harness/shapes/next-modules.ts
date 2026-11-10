import { join } from "node:path";
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
  type ContentProfile,
  type PathVerdict,
  type Shape,
} from "./shape.ts";
import { ALL_TOOL_CONFIG_NAMES, JS_TOOL_CONFIG_NAMES } from "./tool-config-names.ts";

export const VENDORED: readonly string[] = ["src/shared/ui/", "src/shared/lib/utils.ts"];
export const TEST_FILE = /\.test\.tsx?$/;
export const MODULE_ENTRIES: readonly string[] = ["index.ts", "server.ts", "schemas.ts", "types.ts"];

const topFolders = ["src", "e2e", "public"];
const topEntries = [
  ...topFolders,
  "package.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  ...ALL_TOOL_CONFIG_NAMES,
  "components.json",
  ".dependency-cruiser.json",
  ".jscpd.json",
  ".prettierignore",
  ".env.example",
];
const moduleFolders = ["components", "server", "actions", "domain"];
const sharedFolders = ["components", "lib", "hooks"];

/** The src/shared/lib/ helpers the content rules point at, which `init --starter` copies. */
export const STARTER_HELPERS: readonly string[] = ["env.ts", "define-action.ts", "user-error.ts", "format.ts", "log.ts"];

/**
 * One source path per folder and extension this shape allows code in, one per area subfolder level, a colocated test
 * and an automation script, then the fixed names and route segments a config could single out; `{name}` takes a fresh
 * token on each use.
 */
export const SOURCE_PROBES: readonly string[] = [
  "src/app/{name}/{name}.ts",
  "src/app/{name}/{name}.tsx",
  "src/modules/{name}/{name}.ts",
  ...moduleFolders.flatMap((folder) => {
    if (folder === "components") return ["src/modules/{name}/components/{name}.ts", "src/modules/{name}/components/{name}.tsx"];
    if (folder === "actions") return ["src/modules/{name}/actions/{name}-action.ts"];
    return [`src/modules/{name}/${folder}/{name}.ts`];
  }),
  ...moduleFolders
    .filter((folder) => folder !== "actions")
    .map((folder) => `src/modules/{name}/${folder}/{name}/{name}.${folder === "components" ? "tsx" : "ts"}`),
  "src/modules/{name}/domain/{name}.test.ts",
  ...sharedFolders.map((folder) => `src/shared/${folder}/{name}.${folder === "components" ? "tsx" : "ts"}`),
  "scripts/{name}.ts",
  ...["page.tsx", "layout.tsx", "route.ts"].map((file) => `src/app/{name}/${file}`),
  "src/app/{name}/{name}/page.tsx",
  "src/app/({name})/{name}/page.tsx",
  "src/app/[{name}]/page.tsx",
  ...MODULE_ENTRIES.map((file) => `src/modules/{name}/${file}`),
  ...STARTER_HELPERS.map((file) => `src/shared/lib/${file}`),
];

function genericDenial(folder: string): PathVerdict {
  return deny(
    "generic-folder",
    `Name the ${folder}/ subfolder after its area (e.g. pricing/, documents/); code shared across modules belongs in src/shared/lib/.`,
  );
}

function checkApp(parts: string[]): PathVerdict {
  const file = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((part) => !KEBAB.test(part) && !ROUTE_SEGMENT.test(part) && !INTERCEPTING_SEGMENT.test(part))) return nameDenial();
  if (isNextSpecialFile(file, parts.length === 1)) return { ok: true };
  return deny("app-file", "move it into a module's components/ and import it from the module's index.ts");
}

function checkModule(parts: string[]): PathVerdict {
  if (parts.length === 1 && parts[0] === ".gitkeep") return { ok: true };
  const [module, ...inside] = parts;
  if (module && !KEBAB.test(module)) return nameDenial();
  const file = (inside.at(-1) ?? "").replace(TEST_FILE, ".ts");
  if (inside.length === 1 && MODULE_ENTRIES.includes(file)) return { ok: true };
  const folder = inside[0] ?? "";
  if (!moduleFolders.includes(folder) || inside.length < 2) {
    return deny(
      "module-shape",
      "Place module code in components/, server/, actions/ or domain/; expose it through index.ts, server.ts or actions/<name>-action.ts.",
    );
  }
  if (inside.length > (folder === "actions" ? 2 : 3)) {
    return deny("nesting", "Keep actions/ flat; components/, server/ and domain/ permit one area subfolder. Split a new src/modules/<module>/ for more depth.");
  }
  if (inside.slice(0, -1).some((part) => !KEBAB.test(part))) return nameDenial();
  if (inside.length === 3 && GENERIC_FOLDERS.includes(inside[1] ?? "")) return genericDenial(folder);
  if (folder === "actions" && !/^[a-z0-9]+(?:-[a-z0-9]+)*-action\.ts$/.test(file)) {
    return deny("module-shape", "Put Server Actions in actions/<kebab>-action.ts and their tests beside them as <kebab>-action.test.ts(x).");
  }
  return { ok: true };
}

function checkShared(parts: string[]): PathVerdict {
  const folder = parts[0];
  if (folder === "ui" && parts.length >= 2) return { ok: true };
  if (!folder || !sharedFolders.includes(folder) || parts.length < 2) {
    return deny("shared-shape", "Put shared code in src/shared/components/, lib/ or hooks/; generated primitives belong in src/shared/ui/.");
  }
  if (parts.length > (folder === "components" ? 3 : 2)) {
    return deny(
      "nesting",
      "Keep src/shared/lib/ and hooks/ flat; src/shared/components/ permits one area subfolder. Move feature code into src/modules/<module>/.",
    );
  }
  if (parts.slice(0, -1).some((part) => !KEBAB.test(part))) return nameDenial();
  if (folder === "components" && parts.length === 3 && GENERIC_FOLDERS.includes(parts[1] ?? "")) return genericDenial("src/shared/components");
  return { ok: true };
}

const content: ContentProfile = {
  actionFile: /^src\/modules\/[^/]+\/actions\/[^/]+-action\.ts$/,
  actionBuilders: ["defineAction"],
  serverFile: /^src\/modules\/[^/]+\/server(?:\.ts$|\/)/,
  clientFile: /^(?:src\/modules\/[^/]+\/components\/|src\/shared\/(?:components|ui|hooks)\/|src\/app\/(?:.*\/)?error\.tsx$|src\/app\/global-error\.tsx$)/,
  publicIndex: /^src\/modules\/[^/]+\/index\.ts$/,
  actionImport: /^src\/modules\/[^/]+\/actions(?:\/|$)/,
  aliases: { "@/": "src/" },
  envFile: "src/shared/lib/env.ts",
  envScope: /^src\//,
  domainFile: /^src\/modules\/[^/]+\/domain\/(?:[^/]+\/)?[^/]+\.ts$/,
  errorScope: /^src\/app\/|(?:^|\/)components\//,
  messages: {
    serverOnly: 'Import "server-only" in module server.ts and server/ files; client-safe code belongs in components/ or index.ts.',
    useServer: 'Put "use server" first in src/modules/<module>/actions/<name>-action.ts and call defineAction from src/shared/lib/define-action.ts.',
    useClient: 'Put "use client" in module components/, shared components/ui/hooks, or src/app error.tsx and global-error.tsx.',
    clientImportsServer: "Import client-safe code through a module's index.ts or actions/<name>-action.ts; server.ts and server/ belong on the server.",
    indexExports: "Keep index.ts client-safe: expose queries through server.ts and import mutations directly from actions/<name>-action.ts.",
    thinPage: "page.tsx has {count} lines (maximum {max}); move UI into src/modules/<module>/components/ and import it through index.ts.",
    domainTest: "Put the domain rule's test beside it at {test}.",
    envAccess: "Read and validate environment variables in src/shared/lib/env.ts; import its typed env value here.",
    errorText: "Use UserError and user-facing error helpers from src/shared/lib/user-error.ts; keep raw error details in src/shared/lib/log.ts.",
  },
};

function codeIndex(workspaceDir: string): string[] {
  const lines: string[] = [];
  const append = (base: string, file: string): void => {
    const line = exportLine(base, file);
    if (line !== undefined) lines.push(line);
  };
  const modules = join(workspaceDir, "src/modules");
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
  const shared = join(workspaceDir, "src/shared/lib");
  for (const entry of sortedEntries(shared).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name))) {
    append(shared, entry.name);
  }
  return lines;
}

export const nextModules: Shape = {
  name: "next-modules",
  ciAdvice: "Fix application code in src/modules/ or src/shared/; harness code belongs in tooling/harness/ and automation in scripts/.",
  topEntries,
  topFolders,
  kebabFolders: ["src", "e2e"],
  checkHidden(path) {
    const parts = path.split("/");
    if (parts[0] === "src" && parts.slice(1).some((part) => part.startsWith(".") && part !== ".gitkeep")) {
      return deny("hidden-file", "Keep visible source files in src/modules/ or src/shared/; only .gitkeep placeholders may be hidden under src/.");
    }
    return { ok: true };
  },
  isNameExempt(parts, index) {
    const part = parts[index] ?? "";
    if (parts[0] !== "src") return false;
    if (part === ".gitkeep") return true;
    return parts[1] === "app" && index > 1 && index < parts.length - 1 && (ROUTE_SEGMENT.test(part) || INTERCEPTING_SEGMENT.test(part));
  },
  checkPath(path) {
    const parts = path.split("/");
    if (parts[0] !== "src") return { ok: true };
    const area = parts[1];
    if (parts.length === 2 && ["proxy.ts", "instrumentation.ts", "instrumentation-client.ts"].includes(area ?? "")) return { ok: true };
    if (parts.length > 2) {
      if (area === "app") return checkApp(parts.slice(2));
      if (area === "modules") return checkModule(parts.slice(2));
      if (area === "shared") return checkShared(parts.slice(2));
    }
    return deny("src-shape", "Put routes in src/app/, feature code in src/modules/<module>/, and cross-cutting utilities in src/shared/lib/.");
  },
  vendored: VENDORED,
  jsExceptions: JS_TOOL_CONFIG_NAMES,
  routeRoot: "src/app/",
  limits: { fileLines: MAX_FILE_LINES, folderFiles: MAX_FOLDER_FILES, pageLines: MAX_PAGE_LINES },
  folderGuidance: () =>
    "Use one area subfolder in components/, server/ or domain/, or split feature code into a new src/modules/<module>/; keep actions/, lib/ and hooks/ flat.",
  sameNameScope(path) {
    const parts = path.split("/");
    const name = parts.at(-1) ?? "";
    if (parts[0] !== "src" || parts[1] !== "modules" || !parts[2] || parts.length < 4 || TEST_FILE.test(path)) return undefined;
    return MODULE_ENTRIES.includes(name) ? undefined : parts[2];
  },
  content,
  codeIndex,
};
