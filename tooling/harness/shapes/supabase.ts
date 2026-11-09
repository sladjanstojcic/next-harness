import { deny, onlyGitkeepHidden, PLAIN_SHAPE, type ContentProfile, type PathVerdict, type Shape } from "./shape.ts";

const LAYOUT = "(Supabase layout)";
const FREE_FOLDERS = ["templates", "functions", "snippets", ".branches", ".temp"];
const SQL_FOLDERS = ["seeds", "migrations", "schemas", "tests", "volume"];
const topFolders = [...SQL_FOLDERS, ...FREE_FOLDERS];
const topEntries = [...topFolders, "config.toml", "seed.sql", "README.md", "AGENTS.md", "CLAUDE.md", ".gitignore"];
const ok: PathVerdict = { ok: true };

const MIGRATION_ADVICE = "Name migrations <14-digit timestamp>_<name>.sql; create them with supabase migration new <name>.";
const SCHEMA_ADVICE = `Name declarative schema files <2-digit order>-<name>.sql in schemas/ ${LAYOUT}.`;
const TESTS_ADVICE = `Put pgTAP tests in tests/database/<name>.test.sql ${LAYOUT}.`;
const SQL_NAME = /^[a-z0-9][a-z0-9_-]*\.sql$/;

/** One flat folder of SQL files whose names match `name`. */
function flatSql(inside: readonly string[], name: RegExp, rule: "module-shape" | "file-name", advice: string): PathVerdict {
  const [file = "", ...deeper] = inside;
  if (file === ".gitkeep" && deeper.length === 0) return ok;
  return deeper.length === 0 && name.test(file) ? ok : deny(rule, advice);
}

function checkPath(path: string): PathVerdict {
  const [top = "", ...inside] = path.split("/");
  switch (top) {
    case "migrations":
      return flatSql(inside, /^\d{14}_[a-z0-9_-]+\.sql$/, "module-shape", MIGRATION_ADVICE);
    case "schemas":
      return flatSql(inside, /^\d{2}-[a-z0-9-]+\.sql$/, "module-shape", SCHEMA_ADVICE);
    case "tests":
      return inside[0] === "database"
        ? flatSql(inside.slice(1), /^[a-z0-9][a-z0-9_-]*(?:\.test)?\.sql$/, "file-name", TESTS_ADVICE)
        : deny("nesting", TESTS_ADVICE);
    case "seeds":
    case "volume":
      return flatSql(inside, SQL_NAME, "file-name", `Keep ${top}/ flat, with kebab-case <name>.sql files ${LAYOUT}.`);
    default:
      return ok;
  }
}

const NONE = "";
const supabaseContent: ContentProfile = {
  actionBuilders: [],
  aliases: {},
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

export const supabase: Shape = {
  ...PLAIN_SHAPE,
  name: "supabase",
  topEntries,
  topEntryPattern: /^README(?:-[a-z0-9-]+)?\.md$/,
  topFolders,
  checkHidden: onlyGitkeepHidden(SQL_FOLDERS, (top) => `Keep visible SQL files in ${top}/; only .gitkeep may be hidden ${LAYOUT}.`),
  checkPath,
  folderGuidance: () => `Group Edge Function code in a folder per function under functions/ ${LAYOUT}.`,
  content: supabaseContent,
  codeIndex: () => [],
};
