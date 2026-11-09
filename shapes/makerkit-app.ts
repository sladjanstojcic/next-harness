import { join } from "node:path";
import { MAX_FILE_LINES, MAX_FOLDER_FILES, MAX_PAGE_LINES } from "./limits.ts";
import { makerkitAppContent, ROUTE_ACTION_FILE } from "./makerkit-app-content.ts";
import {
  deny,
  exportLine,
  GENERIC_FOLDERS,
  INTERCEPTING_SEGMENT,
  isNextSpecialFile,
  KEBAB,
  ROUTE_SEGMENT,
  sortedEntries,
  type PathVerdict,
  type Shape,
} from "./shape.ts";

const CODE_FOLDERS = ["app", "components", "config", "lib", "i18n", "styles", "content"];
const topFolders = [...CODE_FOLDERS, "public", "supabase"];
const topEntries = [
  ...topFolders,
  ".env",
  ".env.development",
  ".env.production",
  ".env.test",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "instrumentation.ts",
  "instrumentation-client.ts",
  "next-env.d.ts",
  "next.config.mjs",
  "package.json",
  "postcss.config.mjs",
  "proxy.ts",
  "tsconfig.json",
];

const LAYOUT = "(Makerkit layout)";
const ROUTE_ADVICE = `Put route-local UI in the route's _components/ and server code in _lib/server/ ${LAYOUT}.`;
const ROUTE_NAME = `Name route folders in kebab-case, [param], [...slug] or (group), and use only the private _components/ and _lib/ folders ${LAYOUT}.`;
const SOURCE = /\.tsx?$/;

const stem = (name: string): string => name.split(".")[0] ?? "";
const ok: PathVerdict = { ok: true };

/** Files inside one code folder: kebab names, at most one area subfolder named after its area, and the folder's file pattern. */
function checkArea(parts: readonly string[], folder: string, file: RegExp, fileAdvice: string): PathVerdict {
  const name = parts.at(-1) ?? "";
  if (name === ".gitkeep") return ok;
  if (parts.length > 2)
    return deny("nesting", `Keep ${folder} to one area subfolder; move deeper code into a feature package under packages/features/ ${LAYOUT}.`);
  const area = parts.length === 2 ? (parts[0] ?? "") : undefined;
  if (area !== undefined && GENERIC_FOLDERS.includes(area)) {
    return deny("generic-folder", `Name the ${folder} subfolder after its area (e.g. billing/, members/) ${LAYOUT}.`);
  }
  if ((area !== undefined && !KEBAB.test(area)) || !KEBAB.test(stem(name))) return deny("file-name", `Use kebab-case names in ${folder} ${LAYOUT}.`);
  return file.test(name) ? ok : deny("file-name", fileAdvice);
}

function checkLib(parts: readonly string[]): PathVerdict {
  const [folder, ...inside] = parts;
  if (parts.length === 1) return checkArea(parts, "the route's _lib/", SOURCE, `Keep _lib/ for TypeScript helpers ${LAYOUT}.`);
  if (inside.length === 1 && folder === "server")
    return checkArea(inside, "the route's _lib/server/", SOURCE, `Keep _lib/server/ for TypeScript server code ${LAYOUT}.`);
  if (inside.length === 1 && folder === "schema") {
    return checkArea(inside, "the route's _lib/schema/", /\.schema(?:\.test)?\.ts$/, `Name Zod schemas <name>.schema.ts in _lib/schema/ ${LAYOUT}.`);
  }
  return deny("nesting", `Keep the route's _lib/ flat apart from server/ for server code and schema/ for Zod schemas ${LAYOUT}.`);
}

function checkApp(parts: readonly string[]): PathVerdict {
  const name = parts.at(-1) ?? "";
  const folders = parts.slice(0, -1);
  const privateAt = folders.findIndex((part) => part.startsWith("_"));
  const routeFolders = privateAt === -1 ? folders : folders.slice(0, privateAt);
  if (routeFolders.some((part) => !KEBAB.test(part) && !ROUTE_SEGMENT.test(part) && !INTERCEPTING_SEGMENT.test(part))) return deny("file-name", ROUTE_NAME);
  if (privateAt === -1) {
    if (isNextSpecialFile(name, parts.length === 1) || name === "AGENTS.md" || name === "CLAUDE.md") return ok;
    return KEBAB.test(stem(name)) ? deny("app-file", ROUTE_ADVICE) : deny("file-name", ROUTE_NAME);
  }
  const inside = parts.slice(privateAt + 1);
  if (folders[privateAt] === "_components") return checkArea(inside, "the route's _components/", SOURCE, ROUTE_ADVICE);
  if (folders[privateAt] === "_lib") return checkLib(inside);
  return deny("app-file", ROUTE_ADVICE);
}

function checkI18n(parts: readonly string[]): PathVerdict {
  if (parts[0] !== "messages")
    return checkArea(parts, "i18n/", SOURCE, `Keep i18n/ for TypeScript such as request.ts; translations go in i18n/messages/<locale>/ ${LAYOUT}.`);
  const [, locale = "", file = ""] = parts;
  if (parts.length === 3 && /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(locale) && KEBAB.test(stem(file)) && file.endsWith(".json")) return ok;
  return deny("file-name", `Put translations in i18n/messages/<locale>/<namespace>.json ${LAYOUT}.`);
}

function checkContent(parts: readonly string[]): PathVerdict {
  const name = parts.at(-1) ?? "";
  if (parts.length < 2 || parts.length > 3) return deny("nesting", `Put Markdoc files in content/<collection>/ or content/<collection>/<section>/ ${LAYOUT}.`);
  if (parts.some((part) => !KEBAB.test(part === name ? stem(part) : part))) return deny("file-name", `Use kebab-case names in content/ ${LAYOUT}.`);
  return name.endsWith(".mdoc") ? ok : deny("file-name", `Keep content/ for Markdoc (.mdoc) files ${LAYOUT}.`);
}

function checkPath(path: string): PathVerdict {
  const [top = "", ...inside] = path.split("/");
  if (inside.length === 0) return ok;
  switch (top) {
    case "app":
      return checkApp(inside);
    case "components":
      return checkArea(
        inside,
        "components/",
        SOURCE,
        `Keep components/ for app-wide React components; route-local UI goes in the route's _components/ ${LAYOUT}.`,
      );
    case "config":
      return checkArea(inside, "config/", /\.config(?:\.test)?\.tsx?$/, `Name app configuration config/<name>.config.ts(x) ${LAYOUT}.`);
    case "lib":
      if (inside[0] === "server" && inside.length > 1)
        return checkArea(inside.slice(1), "lib/server/", SOURCE, `Keep lib/server/ for TypeScript server code ${LAYOUT}.`);
      return checkArea(inside, "lib/", SOURCE, `Keep lib/ for TypeScript helpers ${LAYOUT}.`);
    case "i18n":
      return checkI18n(inside);
    case "styles":
      return checkArea(inside, "styles/", /\.css$/, `Keep styles/ for CSS files ${LAYOUT}.`);
    case "content":
      return checkContent(inside);
    default:
      return ok;
  }
}

function codeIndex(workspaceDir: string): string[] {
  const actions: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of sortedEntries(join(workspaceDir, folder))) {
      const file = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (ROUTE_ACTION_FILE.test(file)) actions.push(file);
    }
  };
  walk("app");
  const configs = sortedEntries(join(workspaceDir, "config"))
    .filter((entry) => entry.isFile() && /\.config\.tsx?$/.test(entry.name))
    .map((entry) => `config/${entry.name}`);
  const section = (title: string, files: string[]): string[] =>
    files.length === 0 ? [] : ["", title, "", ...files.flatMap((file) => exportLine(workspaceDir, file) ?? [])];
  return [...section("## Route server actions", actions), ...section("## config", configs)];
}

export const makerkitApp: Shape = {
  name: "makerkit-app",
  topEntries,
  topFolders,
  kebabFolders: [],
  checkHidden(path) {
    const [top = "", ...inside] = path.split("/");
    if (CODE_FOLDERS.includes(top) && inside.some((part) => part.startsWith(".") && part !== ".gitkeep")) {
      return deny(
        "hidden-file",
        `Keep visible source files in app/, components/, config/, lib/ and the other app folders; only .gitkeep may be hidden ${LAYOUT}.`,
      );
    }
    return ok;
  },
  isNameExempt: () => false,
  checkPath,
  vendored: [],
  jsExceptions: ["next.config.mjs", "postcss.config.mjs"],
  limits: { fileLines: MAX_FILE_LINES, folderFiles: MAX_FOLDER_FILES, pageLines: MAX_PAGE_LINES },
  folderGuidance: () => `Group route-local UI in a _components/<area>/ subfolder or move the feature into a package under packages/features/ ${LAYOUT}.`,
  sameNameScope: () => undefined,
  content: makerkitAppContent,
  codeIndex,
};
