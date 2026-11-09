export const MAX_FILE_LINES = 250;
export const MAX_FOLDER_FILES = 10;
export const MAX_PAGE_LINES = 60;
export const VENDORED: readonly string[] = ["src/shared/ui/", "src/shared/lib/utils.ts"];
export const JS_EXCEPTIONS: readonly string[] = [];
export const TEST_FILE = /\.test\.tsx?$/;
export const MODULE_ENTRIES: readonly string[] = ["index.ts", "server.ts", "schemas.ts", "types.ts"];

export function isVendored(file: string): boolean {
  return VENDORED.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

const rootFolders = ["src", "tooling", "e2e", "scripts", "docs", "public", ".github", ".githooks", ".claude", ".codex"];
export const ROOT_ENTRIES: readonly string[] = [
  ...rootFolders,
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "eslint.config.ts",
  "prettier.config.ts",
  "knip.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "components.json",
  ".dependency-cruiser.json",
  ".jscpd.json",
  ".gitignore",
  ".mcp.json",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".editorconfig",
  ".gitattributes",
  ".prettierignore",
  ".env.example",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "CHANGELOG.md",
  ...JS_EXCEPTIONS,
];

export type PathRule =
  "unknown-root" | "src-shape" | "app-file" | "module-shape" | "shared-shape" | "nesting" | "generic-folder" | "file-name" | "js-file" | "hidden-file";
export type PathVerdict = { ok: true } | { ok: false; rule: PathRule; reason: string };

const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const routeSegment = /^(?:\[(?:\.\.\.)?[^.[\]]+\]|\[\[\.\.\.[^.[\]]+\]\]|\([^)]+\)|@[a-zA-Z0-9_-]+)$/;
const interceptingSegment = /^(?:\(\.{1,3}\))+[a-z0-9]+(?:-[a-z0-9]+)*$/;
const moduleFolders = ["components", "server", "actions", "domain"];
/** Area subfolders are named after their area; these names describe nothing and become junk drawers. */
const GENERIC_FOLDERS: readonly string[] = ["utils", "helpers", "common", "misc", "shared", "lib", "core", "base", "stuff", "other", "general"];

function genericDenial(folder: string): PathVerdict {
  return deny(
    "generic-folder",
    `Name the ${folder}/ subfolder after its area (e.g. pricing/, documents/); code shared across modules belongs in src/shared/lib/.`,
  );
}

function deny(rule: PathRule, reason: string): PathVerdict {
  return { ok: false, rule, reason };
}

function nameDenial(): PathVerdict {
  return deny("file-name", "Use kebab-case names in src/, tooling/, scripts/ or e2e/; Next route segments belong only in src/app/.");
}

function checkApp(parts: string[]): PathVerdict {
  const file = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((part) => !kebab.test(part) && !routeSegment.test(part) && !interceptingSegment.test(part))) return nameDenial();
  const special = /^(?:page|layout|loading|error|global-error|not-found|template|default|forbidden|unauthorized|global-not-found)\.tsx$/;
  const metadata = /^(?:(?:icon\d*|apple-icon\d*|opengraph-image|twitter-image)\..+|sitemap\.(?:ts|xml)|robots\.(?:ts|txt)|manifest\.(?:ts|json|webmanifest))$/;
  if (special.test(file) || metadata.test(file) || file === "route.ts" || file === "favicon.ico" || (file === "globals.css" && parts.length === 1)) {
    return { ok: true };
  }
  return deny("app-file", "move it into a module's components/ and import it from the module's index.ts");
}

function checkModule(parts: string[]): PathVerdict {
  if (parts.length === 1 && parts[0] === ".gitkeep") return { ok: true };
  const [module, ...inside] = parts;
  if (module && !kebab.test(module)) return nameDenial();
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
  if (inside.slice(0, -1).some((part) => !kebab.test(part))) return nameDenial();
  if (inside.length === 3 && GENERIC_FOLDERS.includes(inside[1] ?? "")) return genericDenial(folder);
  if (folder === "actions" && !/^[a-z0-9]+(?:-[a-z0-9]+)*-action\.ts$/.test(file)) {
    return deny("module-shape", "Put Server Actions in actions/<kebab>-action.ts and their tests beside them as <kebab>-action.test.ts(x).");
  }
  return { ok: true };
}

function checkShared(parts: string[]): PathVerdict {
  const folder = parts[0];
  if (folder === "ui" && parts.length >= 2) return { ok: true };
  if (!folder || !["components", "lib", "hooks"].includes(folder) || parts.length < 2) {
    return deny("shared-shape", "Put shared code in src/shared/components/, lib/ or hooks/; generated primitives belong in src/shared/ui/.");
  }
  if (parts.length > (folder === "components" ? 3 : 2)) {
    return deny(
      "nesting",
      "Keep src/shared/lib/ and hooks/ flat; src/shared/components/ permits one area subfolder. Move feature code into src/modules/<module>/.",
    );
  }
  if (parts.slice(0, -1).some((part) => !kebab.test(part))) return nameDenial();
  if (folder === "components" && parts.length === 3 && GENERIC_FOLDERS.includes(parts[1] ?? "")) return genericDenial("src/shared/components");
  return { ok: true };
}

export function checkPath(relativePath: string): PathVerdict {
  const parts = relativePath.split("/");
  const root = parts[0] ?? "";
  const file = parts.at(-1) ?? "";
  if (!ROOT_ENTRIES.includes(root) || (parts.length > 1 && !rootFolders.includes(root))) {
    return deny("unknown-root", "Use an approved root entry: application code belongs in src/, harness code in tooling/, and automation in scripts/.");
  }
  if (root === "src" && parts.slice(1).some((part) => part.startsWith(".") && part !== ".gitkeep")) {
    return deny("hidden-file", "Keep visible source files in src/modules/ or src/shared/; only .gitkeep placeholders may be hidden under src/.");
  }
  if (/\.(?:js|mjs|cjs|jsx)$/i.test(file) && !JS_EXCEPTIONS.includes(relativePath)) {
    return deny("js-file", "Use TypeScript (.ts/.tsx) in src/, tooling/ or scripts/; unsupported tool configs need an explicit JS_EXCEPTIONS entry.");
  }
  if (["src", "tooling", "scripts", "e2e"].includes(root)) {
    for (const [index, part] of parts.entries()) {
      if (ROOT_ENTRIES.includes(part) || (root === "src" && part === ".gitkeep")) continue;
      if (root === "src" && parts[1] === "app" && index > 1 && index < parts.length - 1 && (routeSegment.test(part) || interceptingSegment.test(part)))
        continue;
      if (!kebab.test(part.split(".")[0] ?? "")) return nameDenial();
    }
  }
  if (root !== "src") return { ok: true };
  const area = parts[1];
  if (parts.length === 2 && ["proxy.ts", "instrumentation.ts", "instrumentation-client.ts"].includes(area ?? "")) return { ok: true };
  if (parts.length > 2) {
    if (area === "app") return checkApp(parts.slice(2));
    if (area === "modules") return checkModule(parts.slice(2));
    if (area === "shared") return checkShared(parts.slice(2));
  }
  return deny("src-shape", "Put routes in src/app/, feature code in src/modules/<module>/, and cross-cutting utilities in src/shared/lib/.");
}
