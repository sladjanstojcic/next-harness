import fs from "node:fs";
import { join, posix } from "node:path";
import { MAKERKIT_ACTION_BUILDERS } from "./makerkit-app-content.ts";
import {
  deny,
  exportLine,
  GENERIC_FOLDERS,
  KEBAB,
  onlyGitkeepHidden,
  PLAIN_SHAPE,
  sortedEntries,
  type ContentProfile,
  type PathVerdict,
  type Shape,
} from "./shape.ts";

const LAYOUT = "(Makerkit layout)";
const topEntries = ["src", "package.json", "tsconfig.json", "README.md", "AGENTS.md", "CLAUDE.md", "vitest.config.ts"];
const ok: PathVerdict = { ok: true };
const SOURCE = /\.tsx?$/;
const TS = /\.ts$/;
const SERVER_ADVICE = `Put server code in src/server/actions/, services/, policies/ or orchestration/, or in src/server/api.ts ${LAYOUT}.`;
const SRC_ADVICE = `Put feature code in src/components/, hooks/, schema/, server/ or shared/; only types.ts and shared.ts sit directly in src/ ${LAYOUT}.`;

const stem = (name: string): string => name.split(".")[0] ?? "";
const untested = (name: string): string => name.replace(/\.test(\.tsx?)$/, "$1");

/** Files in one feature folder: kebab names, up to `areas` subfolders named after their area, and the folder's file pattern. */
function checkArea(parts: readonly string[], folder: string, areas: number, file: RegExp, fileAdvice: string): PathVerdict {
  const name = parts.at(-1) ?? "";
  if (name === ".gitkeep") return ok;
  const subfolders = parts.slice(0, -1);
  if (subfolders.length > areas) {
    const limit = areas === 0 ? "flat" : `to ${areas === 1 ? "one area subfolder" : `${areas} area subfolders`}`;
    return deny("nesting", `Keep ${folder} ${limit} ${LAYOUT}.`);
  }
  if (subfolders.some((area) => GENERIC_FOLDERS.includes(area))) {
    return deny("generic-folder", `Name the ${folder} subfolder after its area (e.g. members/, invitations/) ${LAYOUT}.`);
  }
  if (subfolders.some((area) => !KEBAB.test(area)) || !KEBAB.test(stem(name))) return deny("file-name", `Use kebab-case names in ${folder} ${LAYOUT}.`);
  return file.test(untested(name)) ? ok : deny("file-name", fileAdvice);
}

function checkServer(parts: readonly string[]): PathVerdict {
  const [folder = "", ...inside] = parts;
  if (inside.length === 0) {
    return checkArea(parts, "src/server/", 0, /^(?:api|[a-z0-9-]+-server-actions|[a-z0-9-]+\.service)\.ts$/, SERVER_ADVICE);
  }
  switch (folder) {
    case "actions":
      return checkArea(inside, "src/server/actions/", 0, /-server-actions\.ts$/, `Name Server Action files <name>-server-actions.ts ${LAYOUT}.`);
    case "services":
      return checkArea(inside, "src/server/services/", 1, TS, `Keep src/server/services/ for TypeScript such as <name>.service.ts ${LAYOUT}.`);
    case "policies":
    case "orchestration":
      return checkArea(inside, `src/server/${folder}/`, 0, TS, `Keep src/server/${folder}/ for TypeScript ${LAYOUT}.`);
    default:
      return deny(GENERIC_FOLDERS.includes(folder) ? "generic-folder" : "nesting", SERVER_ADVICE);
  }
}

function checkSrc(parts: readonly string[]): PathVerdict {
  const [folder = "", ...inside] = parts;
  if (inside.length === 0) return /^(?:types|shared)(?:\.test)?\.ts$/.test(folder) ? ok : deny("file-name", SRC_ADVICE);
  switch (folder) {
    case "components":
      return checkArea(inside, "src/components/", 2, SOURCE, `Keep src/components/ for React components ${LAYOUT}.`);
    case "hooks":
      return checkArea(inside, "src/hooks/", 0, /^(?:use-[a-z0-9-]+\.tsx?|index\.ts)$/, `Name hooks use-<name>.ts(x) in src/hooks/ ${LAYOUT}.`);
    case "schema":
      return checkArea(inside, "src/schema/", 0, /\.schema\.ts$/, `Name Zod schemas <name>.schema.ts in src/schema/ ${LAYOUT}.`);
    case "server":
      return checkServer(inside);
    case "shared":
      return checkArea(inside, "src/shared/", 1, TS, `Keep src/shared/ for client-safe TypeScript without React ${LAYOUT}.`);
    default:
      return deny(GENERIC_FOLDERS.includes(folder) ? "generic-folder" : "nesting", SRC_ADVICE);
  }
}

function checkPath(path: string): PathVerdict {
  const [top = "", ...inside] = path.split("/");
  return top === "src" && inside.length > 0 ? checkSrc(inside) : ok;
}

const ACTION_FILE = /^src\/server\/(?:actions\/)?[a-z0-9-]+-server-actions\.ts$/;

const makerkitFeatureContent: ContentProfile = {
  actionFile: ACTION_FILE,
  actionBuilders: MAKERKIT_ACTION_BUILDERS,
  actionImport: /^src\/server\/(?:actions\/)?[a-z0-9-]+-server-actions$/,
  serverFile: /^src\/server\/(?!(?:actions\/)?[a-z0-9-]+-server-actions\.ts$|api\.ts$|(?:.*\/)?index\.ts$)/,
  clientFile: /^src\/(?:components|hooks)\//,
  domainFile: /^src\/shared\/(?:.*\/)?(?!index\.ts$|types\.ts$)[^/]+\.ts$/,
  aliases: {},
  envScope: /^/,
  publicEnvAllowed: true,
  messages: {
    serverOnly: 'Import "server-only" in src/server/ files; client-safe code belongs in src/shared/ (Makerkit layout).',
    useServer:
      'Put "use server" first in src/server/actions/<name>-server-actions.ts and build each action with authActionClient, publicActionClient, captchaActionClient or adminActionClient (Makerkit layout).',
    useClient: 'Put "use client" in src/components/ or src/hooks/ (Makerkit layout).',
    clientImportsServer:
      "Client components may not import src/server/ code other than Server Action files; call a Server Action from src/server/actions/ instead (Makerkit layout).",
    indexExports: "Expose a feature through its package.json exports, not an index file (Makerkit layout).",
    thinPage: "page.tsx has {count} lines (maximum {max}); routes belong in apps/web/app/ (Makerkit layout).",
    domainTest: "Put the rule's test beside it at {test}.",
    envAccess: "Read environment variables in the app's config/<name>.config.ts and pass typed values into the package (Makerkit layout).",
    errorText: "Log the driver error and throw an i18n key instead of raw error text (Makerkit layout).",
  },
};

/** Target files of one package.json exports entry; a `*` pattern lists the files it matches. */
function exportTargets(workspaceDir: string, target: string): string[] {
  const file = posix.normalize(target);
  if (!file.includes("*")) return [file];
  const [before = "", after = ""] = file.split("*");
  const folder = before.slice(0, Math.max(before.lastIndexOf("/"), 0));
  return sortedEntries(join(workspaceDir, folder))
    .filter((entry) => entry.isFile())
    .map((entry) => posix.join(folder, entry.name))
    .filter((candidate) => matchesPattern(candidate, before, after));
}

function matchesPattern(candidate: string, before: string, after: string): boolean {
  return candidate.startsWith(before) && candidate.endsWith(after) && !candidate.slice(before.length, -after.length || undefined).includes("/");
}

function packageExports(workspaceDir: string): [string, string][] {
  const manifest = join(workspaceDir, "package.json");
  if (!fs.existsSync(manifest)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const exports = typeof parsed === "object" && parsed !== null && "exports" in parsed ? parsed.exports : undefined;
    if (typeof exports !== "object" || exports === null) return [];
    return Object.entries(exports).flatMap(([key, value]) => (typeof value === "string" ? [[key, value] as [string, string]] : []));
  } catch {
    return [];
  }
}

function codeIndex(workspaceDir: string): string[] {
  const lines: string[] = [];
  const listed = new Set<string>();
  for (const [key, target] of packageExports(workspaceDir)) {
    for (const file of exportTargets(workspaceDir, target)) {
      const line = exportLine(workspaceDir, file);
      if (line === undefined) continue;
      listed.add(file);
      lines.push(line.replace(/^- /, `- \`${key}\` → `));
    }
  }
  const api = listed.has("src/server/api.ts") ? undefined : exportLine(workspaceDir, "src/server/api.ts");
  if (api !== undefined) lines.push(api);
  return lines.length === 0 ? [] : ["", "## Package exports", "", ...lines];
}

export const makerkitFeature: Shape = {
  ...PLAIN_SHAPE,
  name: "makerkit-feature",
  topEntries,
  topFolders: ["src"],
  checkHidden: onlyGitkeepHidden(["src"], () => `Keep visible source files in src/; only .gitkeep may be hidden ${LAYOUT}.`),
  checkPath,
  folderGuidance: () => `Group the files in an area subfolder named after the area, or split the feature into a second package ${LAYOUT}.`,
  content: makerkitFeatureContent,
  codeIndex,
};
