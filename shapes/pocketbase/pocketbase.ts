import { checkTests, type TestsLayout } from "../e2e.ts";
import { JS_TOOL_CONFIG_NAMES, TOOL_CONFIG_NAMES } from "../tool-config-names.ts";
import { deny, GENERIC_FOLDERS, KEBAB, onlyGitkeepHidden, PLAIN_SHAPE, type ContentProfile, type PathVerdict, type Shape } from "../shape.ts";
import { POCKETBASE_LAYOUT as LAYOUT, pocketbaseSourceRules } from "./source-rules.ts";

const ok: PathVerdict = { ok: true };
const topFolders = ["pb_hooks", "pb_migrations", "shared", "types", "tests"];
/** The folder runs its own ESLint and Prettier, so their configs sit at its top beside the project's files. */
const toolConfigs = [...TOOL_CONFIG_NAMES.eslint, ...TOOL_CONFIG_NAMES.prettier, ".prettierignore"];
const topEntries = [...topFolders, "tsconfig.json", "package.json", "README.md", "AGENTS.md", "CLAUDE.md", ".gitignore", ...toolConfigs];

const ENTRY = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pb\.ts$/;
const KEBAB_TS = /^[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const MIGRATION = /^\d+_[a-z0-9]+(?:[_-][a-z0-9]+)*\.ts$/;
/** The project's own declarations, and the vendored pocketbase*.d.ts whose stem may hold the release, as in pocketbase-0.40.5.d.ts. */
const DECLARATION = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\.d)?\.ts|pocketbase[a-z0-9.-]*\.d\.ts|[^/]+\.md)$/;

const ENTRY_ADVICE = `Only entry files, kebab-case <name>.pb.ts, sit directly in pb_hooks/; put the code they require in pb_hooks/<area>/ ${LAYOUT}.`;
const ENTRY_NAME_ADVICE = `Name entry files in kebab-case, as in pb_hooks/<name>.pb.ts ${LAYOUT}.`;
const AREA_ADVICE = `An area folder of pb_hooks/ holds the .ts files an entry requires; entries stay at the top of pb_hooks/, where PocketBase loads them ${LAYOUT}.`;
const AREA_NAME_ADVICE = `Use kebab-case names in pb_hooks/<area>/, as in pb_hooks/renewals/commands.ts ${LAYOUT}.`;
const HOOKS_NESTING_ADVICE = `Keep pb_hooks/ to one level of area folders, as in pb_hooks/<area>/<name>.ts ${LAYOUT}.`;
const HOOKS_GENERIC_ADVICE = `Name the pb_hooks/ subfolder after its area (e.g. renewals/, sessions/) ${LAYOUT}.`;
const MIGRATION_ADVICE = `Keep pb_migrations/ flat, with files named <digits>_<name>.ts in lower case, as in 1700000000_add-index.ts ${LAYOUT}.`;
const SHARED_NESTING_ADVICE = `Keep shared/ flat: shared/<name>.ts ${LAYOUT}.`;
const SHARED_NAME_ADVICE = `Use kebab-case .ts files in shared/, as in shared/listing-values.ts ${LAYOUT}.`;
const TYPES_NESTING_ADVICE = `Keep types/ flat: types/<name>.d.ts ${LAYOUT}.`;
const TYPES_NAME_ADVICE = `Use kebab-case .ts or .d.ts files in types/, beside the vendored pocketbase*.d.ts and any .md ${LAYOUT}.`;

const POCKETBASE_TESTS: TestsLayout = {
  layout: LAYOUT,
  topAdvice: `Put tests in a suite folder, as in tests/<suite>/<name>.test.ts; no file sits directly in tests/ ${LAYOUT}.`,
};

function checkHooks(inside: readonly string[]): PathVerdict {
  const [first = "", name = "", ...deeper] = inside;
  if (inside.length === 1) {
    if (first === ".gitkeep" || ENTRY.test(first)) return ok;
    return first.endsWith(".pb.ts") ? deny("file-name", ENTRY_NAME_ADVICE) : deny("module-shape", ENTRY_ADVICE);
  }
  if (deeper.length > 0) return deny("nesting", HOOKS_NESTING_ADVICE);
  if (GENERIC_FOLDERS.includes(first)) return deny("generic-folder", HOOKS_GENERIC_ADVICE);
  if (!KEBAB.test(first)) return deny("file-name", AREA_NAME_ADVICE);
  if (name === ".gitkeep") return ok;
  if (name.endsWith(".pb.ts") || !name.endsWith(".ts")) return deny("module-shape", AREA_ADVICE);
  return KEBAB_TS.test(name) ? ok : deny("file-name", AREA_NAME_ADVICE);
}

/** One flat folder whose files match `name`. */
function flat(inside: readonly string[], name: RegExp, nesting: PathVerdict, misnamed: PathVerdict): PathVerdict {
  const [file = "", ...deeper] = inside;
  if (deeper.length > 0) return nesting;
  return file === ".gitkeep" || name.test(file) ? ok : misnamed;
}

function checkPath(path: string): PathVerdict {
  const [top = "", ...inside] = path.split("/");
  if (inside.length === 0) return ok;
  switch (top) {
    case "pb_hooks":
      return checkHooks(inside);
    case "pb_migrations":
      return flat(inside, MIGRATION, deny("module-shape", MIGRATION_ADVICE), deny("module-shape", MIGRATION_ADVICE));
    case "shared":
      return flat(inside, KEBAB_TS, deny("nesting", SHARED_NESTING_ADVICE), deny("file-name", SHARED_NAME_ADVICE));
    case "types":
      return flat(inside, DECLARATION, deny("nesting", TYPES_NESTING_ADVICE), deny("file-name", TYPES_NAME_ADVICE));
    case "tests":
      return checkTests(inside, POCKETBASE_TESTS);
    default:
      return ok;
  }
}

/** The paths the ESLint preset check probes, `{name}` standing for a fresh token: an entry, hook code, a migration, a shared value, a test. */
export const POCKETBASE_PROBES: readonly string[] = [
  "pb_hooks/{name}.pb.ts",
  "pb_hooks/{name}/{name}.ts",
  "pb_migrations/1_{name}.ts",
  "shared/{name}.ts",
  "tests/{name}/{name}.test.ts",
];

const NONE = "";
const pocketbaseContent: ContentProfile = {
  actionBuilders: [],
  aliases: {},
  integrationTests: /^tests\//,
  inlineDisable: `Remove the {directive} comment and fix the code it silences; hook code may not turn off lint rules or type checks ${LAYOUT}.`,
  sourceRules: pocketbaseSourceRules,
  messages: {
    serverOnly: NONE,
    useServer: NONE,
    useClient: NONE,
    clientImportsServer: NONE,
    indexExports: NONE,
    thinPage: NONE,
    domainTest: NONE,
    envAccess: NONE,
    errorText: NONE,
  },
};

/** A PocketBase backend beside the app: hooks the VM loads, migrations, values the app shares, and tests against a running server. */
export const pocketbase: Shape = {
  ...PLAIN_SHAPE,
  name: "pocketbase",
  topEntries,
  topEntryPattern: /^README(?:-[a-z0-9-]+)?\.md$/,
  topFolders,
  jsExceptions: JS_TOOL_CONFIG_NAMES.filter((name) => toolConfigs.includes(name)),
  checkHidden: onlyGitkeepHidden(topFolders, (top) => `Keep visible files in ${top}/; only .gitkeep may be hidden ${LAYOUT}.`),
  checkPath,
  vendoredPattern: /^types\/pocketbase[^/]*\.d\.ts$/,
  vendoredAdvice: "copy pb_data/types.d.ts, which PocketBase writes at its first serve, to <file>; keep your own declarations in another file in types/",
  unlimitedFolders: ["pb_migrations"],
  folderGuidance: () => `Group the files an entry requires in pb_hooks/<area>/, and split an area that has grown past the limit ${LAYOUT}.`,
  content: pocketbaseContent,
  codeIndex: () => [],
};
