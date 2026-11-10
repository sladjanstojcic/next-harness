import fs from "node:fs";
import path from "node:path";
import { indentOf, isObject, readJson } from "./files.ts";

/** The bootstrap runs before the harness's own dependencies are installed, so it imports Node built-ins only. */
export const HARNESS_PACKAGE = "tooling/harness";
const HARNESS = path.resolve(import.meta.dirname, "../..");
const MANUAL = `add ${HARNESS_PACKAGE} to the workspace packages by hand`;

type Manager = "pnpm" | "npm" | "yarn";

/** The commands init prints, in the project's package manager. */
export interface ManagerCommands {
  install: string;
  add: string;
  addDev: string;
  /** Runs a binary of the project's dependencies. */
  exec: string;
  /** Runs a package script; yarn's own `check` command would shadow the harness's. */
  run: string;
}

const COMMANDS: Readonly<Record<Manager, ManagerCommands>> = {
  pnpm: { install: "pnpm install", add: "pnpm add", addDev: "pnpm add -D", exec: "pnpm exec", run: "pnpm run" },
  npm: { install: "npm install", add: "npm install", addDev: "npm install -D", exec: "npx", run: "npm run" },
  yarn: { install: "yarn install", add: "yarn add", addDev: "yarn add -D", exec: "yarn", run: "yarn run" },
};

/** The package manager the repository root declares or its lockfile shows; pnpm when nothing says. */
function packageManager(root: string): Manager {
  const declared = readJson(path.join(root, "package.json"), "package.json")?.packageManager;
  if (typeof declared === "string") {
    const name = declared.split("@")[0];
    if (name === "npm" || name === "yarn" || name === "pnpm") return name;
  }
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  return "pnpm";
}

const matches = (pattern: string): boolean => path.posix.matchesGlob(HARNESS_PACKAGE, pattern.replace(/^\.\//, "").replace(/\/+$/, ""));

/** The negated pattern that keeps the harness folder out, if any; a later positive pattern does not bring it back. */
const exclusion = (patterns: readonly string[]): string | undefined => patterns.find((pattern) => pattern.startsWith("!") && matches(pattern.slice(1)));

/** Whether the patterns list the harness folder: a positive pattern matches it and no negated one excludes it. */
const lists = (patterns: readonly string[]): boolean =>
  patterns.some((pattern) => !pattern.startsWith("!") && matches(pattern)) && exclusion(patterns) === undefined;

const unquote = (value: string): string => value.trim().replace(/^(['"])(.*)\1$/, "$2");

interface YamlPackages {
  patterns: string[];
  /** Where a new block entry goes, with its indent; undefined when the list is not a plain block list. */
  insertAt?: { line: number; indent: string };
}

/** The `packages` list of a pnpm-workspace.yaml as written in block style; undefined when the key is absent. */
function yamlPackages(lines: readonly string[]): YamlPackages | undefined {
  const key = lines.findIndex((line) => /^packages:/.test(line));
  if (key === -1) return undefined;
  const rest = (lines[key] ?? "")
    .slice("packages:".length)
    .replace(/\s+#.*$/, "")
    .trim();
  if (rest !== "") {
    const flow = /^\[(.*)\]$/.exec(rest);
    return { patterns: flow?.[1]?.split(",").map(unquote).filter(Boolean) ?? [] };
  }
  const patterns: string[] = [];
  let last = key;
  let indent = "  ";
  for (let index = key + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const item = /^(\s+)-\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (item !== null) {
      patterns.push(unquote(item[2] ?? ""));
      indent = item[1] ?? indent;
      last = index;
    } else if (line.trim() !== "" && !line.trim().startsWith("#")) break;
  }
  return { patterns, insertAt: { line: last + 1, indent } };
}

/** npm's and yarn's `workspaces`: an array of patterns, or yarn's object holding one under `packages`. */
function workspacePatterns(workspaces: unknown): string[] | undefined {
  const listed: unknown = isObject(workspaces) ? workspaces.packages : workspaces;
  return Array.isArray(listed) ? listed.filter((entry): entry is string => typeof entry === "string") : undefined;
}

/** Lists the harness folder as a workspace package, so the package manager installs its pinned dependencies. */
function addWorkspace(root: string, manager: Manager): string {
  if (manager === "pnpm") {
    const file = path.join(root, "pnpm-workspace.yaml");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const lines = text.split("\n");
    const packages = yamlPackages(lines);
    if (packages !== undefined && lists(packages.patterns)) return `unchanged pnpm-workspace.yaml: packages list ${HARNESS_PACKAGE}`;
    if (packages === undefined) {
      fs.writeFileSync(file, `packages:\n  - ${HARNESS_PACKAGE}\n${text}`);
      return `${text === "" ? "created" : "updated"} pnpm-workspace.yaml: packages ${HARNESS_PACKAGE}`;
    }
    const excluded = exclusion(packages.patterns);
    if (excluded !== undefined) return `kept pnpm-workspace.yaml: ${excluded} leaves it out; ${MANUAL}`;
    if (packages.insertAt === undefined) return `kept pnpm-workspace.yaml: its packages list is not a block list; ${MANUAL}`;
    lines.splice(packages.insertAt.line, 0, `${packages.insertAt.indent}- ${HARNESS_PACKAGE}`);
    fs.writeFileSync(file, lines.join("\n"));
    return `updated pnpm-workspace.yaml: packages ${HARNESS_PACKAGE} added, the rest kept`;
  }
  const file = path.join(root, "package.json");
  const pkg = readJson(file, "package.json") ?? {};
  const { workspaces } = pkg;
  const listed = workspacePatterns(workspaces);
  if (workspaces !== undefined && listed === undefined) return `kept package.json: workspaces has a shape init cannot read; ${MANUAL}`;
  const patterns = listed ?? [];
  if (lists(patterns)) return `unchanged package.json: workspaces list ${HARNESS_PACKAGE}`;
  const excluded = exclusion(patterns);
  if (excluded !== undefined) return `kept package.json: ${excluded} leaves it out; ${MANUAL}`;
  const added = [...patterns, HARNESS_PACKAGE];
  const next = { ...pkg, workspaces: isObject(workspaces) ? { ...workspaces, packages: added } : added };
  fs.writeFileSync(file, `${JSON.stringify(next, null, indentOf(file))}\n`);
  return `updated package.json: workspaces ${HARNESS_PACKAGE} added, other keys kept`;
}

/** Whether the patterns of the folder's workspace file list the harness folder; knip treats a listed harness as a workspace. */
export function managerCommands(root: string): ManagerCommands {
  return COMMANDS[packageManager(root)];
}

export function harnessIsWorkspace(dir: string): boolean {
  const yaml = path.join(dir, "pnpm-workspace.yaml");
  if (fs.existsSync(yaml) && lists(yamlPackages(fs.readFileSync(yaml, "utf8").split("\n"))?.patterns ?? [])) return true;
  return lists(workspacePatterns(readJson(path.join(dir, "package.json"), "package.json")?.workspaces) ?? []);
}

/** The harness's own dependencies that no node_modules folder from the harness up to the filesystem root provides. */
function missingDependencies(): string[] {
  const dependencies = readJson(path.join(HARNESS, "package.json"), "package.json")?.dependencies;
  const names = isObject(dependencies) ? Object.keys(dependencies) : [];
  const reachable = (name: string): boolean => {
    for (let dir = HARNESS; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "node_modules", name, "package.json"))) return true;
      if (dir === path.dirname(dir)) return false;
    }
  };
  return names.filter((name) => !reachable(name));
}

/**
 * Init's first step on a fresh subtree: with the harness's dependencies installed it does nothing; otherwise it lists the
 * harness as a workspace package and says to install and rerun, since the rest of init needs those dependencies.
 */
export function bootstrapHarness(root: string, flags: readonly string[]): { ready: boolean; report: string } {
  const missing = missingDependencies();
  if (missing.length === 0) return { ready: true, report: "" };
  const manager = packageManager(root);
  const { install } = COMMANDS[manager];
  return {
    ready: false,
    report: [
      addWorkspace(root, manager),
      `The harness's own dependencies (${missing.join(", ")}) are not installed. Next steps:`,
      `  1. ${install}`,
      `  2. ${["node", `${HARNESS_PACKAGE}/cli.ts`, "init", ...flags].join(" ")}`,
    ].join("\n"),
  };
}
