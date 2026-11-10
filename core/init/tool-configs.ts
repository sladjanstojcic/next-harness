import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkspaceEntry } from "../../config.ts";
import { TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { eslintPresetLines, presetImport } from "../../tools/eslint-preset.ts";
import { managerCommands } from "./bootstrap.ts";
import { writer, type Step } from "./files.ts";
import { tsconfigStep } from "./tsconfig-step.ts";

const HARNESS = path.resolve(import.meta.dirname, "../..");
const STARTER = path.join(HARNESS, "presets/starter");

interface ToolConfig {
  /** The names the tool reads its config from, init's own first; a project's own config is never replaced. */
  names: readonly string[];
  /** Text that shows a config already uses the preset. */
  marker: string;
  text(workspace: WorkspaceEntry): string;
  /** Where the lines go, when the lines do not say it themselves. */
  placement?: string;
  /** The lines that add the preset to a project's own config, given its text. */
  lines(workspace: WorkspaceEntry, own: string): string[];
}

const TOOL_CONFIGS: readonly ToolConfig[] = [
  {
    names: TOOL_CONFIG_NAMES.eslint,
    marker: "harnessEslint(",
    text: (workspace) =>
      `import { harnessEslint } from "${presetImport(workspace.path, "eslint.ts")}";\n\nexport default harnessEslint({ root: import.meta.dirname${workspace.next ? ", next: true" : ""} });\n`,
    placement: "the import at the top of the file, the spread as the last element of the exported array",
    lines: (workspace, own) => eslintPresetLines(workspace.path, workspace.next, own),
  },
  {
    names: TOOL_CONFIG_NAMES.prettier,
    marker: "presets/prettier.ts",
    text: (workspace) => `export { default } from "${presetImport(workspace.path, "prettier.ts")}";\n`,
    lines: (workspace) => [
      `import harnessPrettier from "${presetImport(workspace.path, "prettier.ts")}";`,
      "...harnessPrettier, // first in the exported object",
    ],
  },
  {
    names: TOOL_CONFIG_NAMES.vitest,
    marker: "harnessVitest(",
    text: (workspace) => `import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";\n\nexport default harnessVitest();\n`,
    lines: (workspace) => [
      `import { mergeConfig } from "vitest/config"; import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";`,
      "export default mergeConfig(harnessVitest(), yourConfig);",
    ],
  },
  {
    names: TOOL_CONFIG_NAMES.knip,
    marker: "harnessKnip",
    text: (workspace) => `import { harnessKnip } from "${presetImport(workspace.path, "knip.ts")}";\n\nexport default harnessKnip();\n`,
    lines: (workspace) => [`import { harnessKnip } from "${presetImport(workspace.path, "knip.ts")}";`, "...harnessKnip(), // first in the exported object"],
  },
];

/** Browser tests run only for a Next workspace at the git root, where the CI gate builds and serves it. */
const PLAYWRIGHT: ToolConfig = {
  names: TOOL_CONFIG_NAMES.playwright,
  marker: "harnessPlaywright(",
  text: (workspace) => `import { harnessPlaywright } from "${presetImport(workspace.path, "playwright.ts")}";\n\nexport default harnessPlaywright();\n`,
  lines: (workspace) => [
    `import { defineConfig } from "@playwright/test"; import { harnessPlaywright } from "${presetImport(workspace.path, "playwright.ts")}";`,
    "export default defineConfig(harnessPlaywright(), yourConfig);",
  ],
};

const label = (workspace: WorkspaceEntry, file: string): string => (workspace.path === "" ? file : `${workspace.path}/${file}`);

function toolConfigStep(root: string, workspace: WorkspaceEntry, tool: ToolConfig): Step {
  const dir = path.join(root, workspace.path);
  const own = tool.names.find((name) => fs.existsSync(path.join(dir, name)));
  const file = tool.names[0] ?? "";
  if (own === undefined) {
    return { target: label(workspace, file), status: "created", detail: "harness preset", apply: writer(path.join(dir, file), tool.text(workspace)) };
  }
  const text = fs.readFileSync(path.join(dir, own), "utf8");
  if (text.includes(tool.marker)) return { target: label(workspace, own), status: "unchanged", detail: "uses the harness preset" };
  const lines = tool.lines(workspace, text).map((line) => `\n    ${line}`);
  return {
    target: label(workspace, own),
    status: "kept",
    detail: `your config stays; add the harness preset to it${tool.placement === undefined ? "" : `, ${tool.placement}`}:${lines.join("")}`,
    todo: true,
  };
}

function dependencyCruiserStep(root: string, workspace: WorkspaceEntry, force: boolean): Step {
  const target = label(workspace, ".dependency-cruiser.json");
  const file = path.join(root, target);
  const text = `{\n  "extends": "${presetImport(workspace.path, "dependency-cruiser.json")}"\n}\n`;
  const apply = writer(file, text);
  if (!fs.existsSync(file)) return { target, status: "created", detail: "harness preset", apply };
  if (fs.readFileSync(file, "utf8") === text) return { target, status: "unchanged", detail: "harness preset" };
  if (!force) return { target, status: "conflict", detail: "holds other rules; --force replaces it with the harness preset" };
  return { target, status: "updated", detail: "replaced by the harness preset", apply };
}

const IGNORED = [".next/", "test-results/"];
/** pnpm links the harness's own dependencies here once it is a workspace package; create-next-app ignores only `/node_modules`. */
export const HARNESS_MODULES = "tooling/harness/node_modules/";

/** Appends the entries an ignore file lacks, keeping its lines; `isMissing` decides with the file as it stands. */
function ignoreFileStep(root: string, target: string, entries: readonly string[], isMissing: (entry: string, current: string) => boolean): Step {
  const file = path.join(root, target);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = entries.filter((entry) => isMissing(entry, current));
  if (missing.length === 0) return { target, status: "unchanged", detail: entries.join(", ") };
  const text = `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`;
  return { target, status: current === "" ? "created" : "updated", detail: missing.join(", "), apply: writer(file, text) };
}

/** Appends to a folder's .gitignore the entries no ignore rule of the repository covers yet; entries are relative to that folder. */
export function gitignoreStep(root: string, folder: string, entries: readonly string[]): Step {
  const at = (file: string): string => (folder === "" ? file : `${folder}/${file}`);
  return ignoreFileStep(
    root,
    at(".gitignore"),
    entries,
    (entry) => spawnSync("git", ["check-ignore", "-q", "--no-index", at(entry)], { cwd: root, stdio: "ignore" }).status !== 0,
  );
}

/** Files the format check must skip: pnpm's own lockfile style, the vendored shadcn primitives and the build output. */
const PRETTIER_IGNORED = ["pnpm-lock.yaml", "src/shared/ui", ".next"];

function prettierignoreStep(root: string, workspace: WorkspaceEntry): Step {
  const listed = (current: string): Set<string> => new Set(current.split(/\r?\n/).map((line) => line.trim().replace(/^\/|\/$/g, "")));
  return ignoreFileStep(root, label(workspace, ".prettierignore"), PRETTIER_IGNORED, (entry, current) => !listed(current).has(entry));
}

/** Scripts a workspace gets when it has none of that name; the root's harness scripts come from the wiring. */
export function toolScripts(workspace: WorkspaceEntry): Record<string, string> {
  return {
    lint: "eslint . --max-warnings 0",
    typecheck: workspace.next ? "next typegen && tsc --noEmit" : "tsc --noEmit",
    test: "vitest run",
    depcruise: "depcruise src --config .dependency-cruiser.json",
    knip: "knip",
    jscpd: `jscpd src --config ${presetImport(workspace.path, "jscpd.json")}`,
    format: "prettier --write .",
  };
}

/** Copies the starter files kept under presets/starter/<set>/ as `.txt` into a workspace folder, never over a changed file. */
function starterSteps(root: string, workspace: WorkspaceEntry, set: string, folder: string): Step[] {
  return fs
    .readdirSync(path.join(STARTER, set))
    .sort()
    .map((name) => {
      const target = label(workspace, `${folder}/${name.replace(/\.txt$/, "")}`);
      const text = fs.readFileSync(path.join(STARTER, set, name), "utf8");
      const file = path.join(root, target);
      if (!fs.existsSync(file)) return { target, status: "created", detail: "starter file", apply: writer(file, text) };
      return fs.readFileSync(file, "utf8") === text
        ? { target, status: "unchanged", detail: "starter file" }
        : { target, status: "kept", detail: "your file stays; the harness's starter copy differs" };
    });
}

/** Tool config, ignore and starter steps of every eslint-prettier workspace; package scripts are the caller's, since the root file also takes the wiring scripts. */
export function toolConfigSteps(root: string, workspace: WorkspaceEntry, force: boolean, starter: boolean): Step[] {
  const browser = workspace.path === "" && workspace.next;
  return [
    ...TOOL_CONFIGS.map((tool) => toolConfigStep(root, workspace, tool)),
    ...(browser ? [toolConfigStep(root, workspace, PLAYWRIGHT)] : []),
    dependencyCruiserStep(root, workspace, force),
    tsconfigStep(root, workspace, force),
    gitignoreStep(root, workspace.path, workspace.path === "" ? [...IGNORED, HARNESS_MODULES] : IGNORED),
    prettierignoreStep(root, workspace),
    ...(starter && workspace.shape === "next-modules" ? starterSteps(root, workspace, "next-modules", "src/shared/lib") : []),
    ...(starter && browser ? starterSteps(root, workspace, "e2e", "e2e") : []),
  ];
}

const manifest = z.object({
  version: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

const readManifest = (file: string) => manifest.parse(JSON.parse(fs.readFileSync(file, "utf8")));

/** server-only is the starter's other runtime dependency; the harness itself does not import it. */
const STARTER_RUNTIME: Readonly<Record<string, string>> = { "server-only": "0.0.1" };

const inWorkspace = (workspace: WorkspaceEntry, command: string): string => (workspace.path === "" ? command : `cd ${workspace.path} && ${command}`);

/** The version a node_modules folder between the workspace and the git root provides, or undefined. */
function reachableVersion(root: string, workspace: WorkspaceEntry, name: string): string | undefined {
  for (let dir = path.join(root, workspace.path); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(file)) return readManifest(file).version ?? "";
    if (path.relative(root, dir) === "") return undefined;
  }
}

const major = (version: string): string => /^\D*(\d+)/.exec(version)?.[1] ?? "";

/**
 * The install line for the peer tools no folder up to the git root provides, or provides at another major version
 * (create-next-app's @types/node 20 fails Vitest's peer range); init does not install.
 */
export function peerInstall(root: string, workspace: WorkspaceEntry): string | undefined {
  const { peerDependencies = {} } = readManifest(path.join(HARNESS, "package.json"));
  const missing = Object.entries(peerDependencies).filter(([name, version]) => major(reachableVersion(root, workspace, name) ?? "") !== major(version));
  if (missing.length === 0) return undefined;
  return inWorkspace(workspace, `${managerCommands(root).addDev} ${missing.map(([name, version]) => `${name}@${version}`).join(" ")}`);
}

/** The install line for the runtime packages the starter files import and the workspace's package.json does not declare. */
export function starterInstall(root: string, workspace: WorkspaceEntry): string | undefined {
  const { dependencies: harness = {} } = readManifest(path.join(HARNESS, "package.json"));
  const { dependencies = {}, devDependencies = {} } = readManifest(path.join(root, workspace.path, "package.json"));
  const wanted = { zod: harness.zod ?? "", ...STARTER_RUNTIME };
  const missing = Object.entries(wanted).filter(([name]) => dependencies[name] === undefined && devDependencies[name] === undefined);
  if (missing.length === 0) return undefined;
  return inWorkspace(workspace, `${managerCommands(root).add} ${missing.map(([name, version]) => `${name}@${version}`).join(" ")}`);
}
