import { CONFIG_FILE, type HarnessConfig } from "../config.ts";

const ROOT_FOLDERS: readonly string[] = ["tooling", "scripts", "docs", ".github", ".githooks", ".claude", ".codex"];
const ROOT_ENTRIES: readonly string[] = [
  ...ROOT_FOLDERS,
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  ".gitignore",
  ".mcp.json",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".editorconfig",
  ".gitattributes",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "CHANGELOG.md",
];
const JS_EXCEPTIONS: readonly string[] = [];
export const ROOT_KEBAB_FOLDERS: readonly string[] = ["tooling", "scripts"];
export const ROOT_FOLDER_GUIDANCE = "Move cohesive code into a focused subfolder under tooling/ or scripts/.";

export interface RootLayout {
  entries: Set<string>;
  folders: Set<string>;
  jsExceptions: Set<string>;
}

export function rootEntries(config: HarnessConfig, hasConfigFile = false): RootLayout {
  const extra = config.root?.entries ?? [];
  const jsExceptions = new Set([...JS_EXCEPTIONS, ...(config.root?.jsExceptions ?? [])]);
  return {
    entries: new Set([...ROOT_ENTRIES, ...extra, ...jsExceptions, ...(hasConfigFile ? [CONFIG_FILE] : [])]),
    folders: new Set([...ROOT_FOLDERS, ...extra]),
    jsExceptions,
  };
}
