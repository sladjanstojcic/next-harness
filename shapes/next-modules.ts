import { MAX_FILE_LINES, MAX_FOLDER_FILES, MAX_PAGE_LINES } from "./limits.ts";
import { deny, GENERIC_FOLDERS, INTERCEPTING_SEGMENT, KEBAB, matchesEntry, nameDenial, ROUTE_SEGMENT, type PathVerdict, type Shape } from "./shape.ts";

export const VENDORED: readonly string[] = ["src/shared/ui/", "src/shared/lib/utils.ts"];
export const TEST_FILE = /\.test\.tsx?$/;
export const MODULE_ENTRIES: readonly string[] = ["index.ts", "server.ts", "schemas.ts", "types.ts"];

export function isVendored(file: string): boolean {
  return matchesEntry(VENDORED, file);
}

const topFolders = ["src", "e2e", "public"];
const topEntries = [
  ...topFolders,
  "package.json",
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
  ".prettierignore",
  ".env.example",
];
const moduleFolders = ["components", "server", "actions", "domain"];

function genericDenial(folder: string): PathVerdict {
  return deny(
    "generic-folder",
    `Name the ${folder}/ subfolder after its area (e.g. pricing/, documents/); code shared across modules belongs in src/shared/lib/.`,
  );
}

function checkApp(parts: string[]): PathVerdict {
  const file = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((part) => !KEBAB.test(part) && !ROUTE_SEGMENT.test(part) && !INTERCEPTING_SEGMENT.test(part))) return nameDenial();
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
  if (!folder || !["components", "lib", "hooks"].includes(folder) || parts.length < 2) {
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

export const nextModules: Shape = {
  name: "next-modules",
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
};
