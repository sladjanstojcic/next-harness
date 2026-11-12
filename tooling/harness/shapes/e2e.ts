import { deny, GENERIC_FOLDERS, KEBAB, onlyGitkeepHidden, PLAIN_SHAPE, type ContentProfile, type PathVerdict, type Shape } from "./shape.ts";

const LAYOUT = "(e2e layout)";
const ok: PathVerdict = { ok: true };
/** A suite folder and two levels of area folders inside it: tests/<suite>/<area>/<area>/. */
const MAX_FOLDERS = 3;
const topEntries = ["tests", "package.json", "playwright.config.ts", "tsconfig.json", "AGENTS.md", "CLAUDE.md", ".gitignore"];

const TOP_ADVICE = `An e2e workspace takes package.json, playwright.config.ts, tsconfig.json and tests/ at its top; put test code in tests/<suite>/ ${LAYOUT}.`;
const TOP_FILE_ADVICE = `Only <name>.spec.ts and <name>.setup.ts sit directly in tests/; put page objects and helpers in tests/<suite>/ ${LAYOUT}.`;
const NESTING_ADVICE = `Keep tests/ to a suite folder with at most two levels of area folders, as in tests/<suite>/<area>/<area>/ ${LAYOUT}.`;
const GENERIC_ADVICE = `Name the tests/ subfolder after what it tests or holds (e.g. checkout/, world/, page-objects/) ${LAYOUT}.`;
const NAME_ADVICE = `Use kebab-case names in tests/, with one optional role before the extension, as in <name>.spec.ts or <name>.po.ts ${LAYOUT}.`;
/** A kebab-case stem and at most one role, such as spec, setup or po. */
const TS_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z]+)?\.ts$/;

function checkTests(parts: readonly string[]): PathVerdict {
  const name = parts.at(-1) ?? "";
  const folders = parts.slice(0, -1);
  if (name === ".gitkeep") return ok;
  if (folders.length > MAX_FOLDERS) return deny("nesting", NESTING_ADVICE);
  if (folders.some((folder) => GENERIC_FOLDERS.includes(folder))) return deny("generic-folder", GENERIC_ADVICE);
  if (folders.some((folder) => !KEBAB.test(folder))) return deny("file-name", NAME_ADVICE);
  // Data a test reads, such as an image to upload, keeps its own extension; its name follows the same case.
  if (!name.endsWith(".ts")) return KEBAB.test(name.split(".")[0] ?? "") ? ok : deny("file-name", NAME_ADVICE);
  if (!TS_FILE.test(name)) return deny("file-name", NAME_ADVICE);
  return folders.length > 0 || /\.(?:spec|setup)\.ts$/.test(name) ? ok : deny("module-shape", TOP_FILE_ADVICE);
}

function checkPath(path: string): PathVerdict {
  const [top = "", ...inside] = path.split("/");
  return top === "tests" && inside.length > 0 ? checkTests(inside) : ok;
}

const NONE = "";
const e2eContent: ContentProfile = {
  actionBuilders: [],
  aliases: {},
  inlineDisable: `Remove the {directive} comment and fix the code it silences; test code may not turn off lint rules or type checks ${LAYOUT}.`,
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

/** A folder of Playwright tests beside the apps of a monorepo, such as apps/e2e: browser tests and tests through the real API. */
export const e2e: Shape = {
  ...PLAIN_SHAPE,
  name: "e2e",
  ciAdvice: `Fix test code in tests/<suite>/ ${LAYOUT}.`,
  topEntries,
  // The committed and local .env files; the env guard decides which of them an agent may write.
  topEntryPattern: /^(?:README(?:-[a-z0-9-]+)?\.md|\.env(?:\.[a-z]+){0,2})$/,
  topFolders: ["tests"],
  topAdvice: TOP_ADVICE,
  checkHidden: onlyGitkeepHidden(["tests"], () => `Keep visible test files in tests/; only .gitkeep may be hidden ${LAYOUT}.`),
  checkPath,
  folderGuidance: () => `Group the files in a folder named after what they test, or split the suite in two ${LAYOUT}.`,
  content: e2eContent,
  codeIndex: () => [],
};
