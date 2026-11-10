import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkspaceEntry } from "../../config.ts";
import { TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { eslintPresetLines, presetImport } from "../../tools/eslint-preset.ts";
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
  /** The lines that add the preset to a project's own config. */
  lines(workspace: WorkspaceEntry): string[];
}

const TOOL_CONFIGS: readonly ToolConfig[] = [
  {
    names: TOOL_CONFIG_NAMES.eslint,
    marker: "harnessEslint(",
    text: (workspace) =>
      `import { harnessEslint } from "${presetImport(workspace.path, "eslint.ts")}";\n\nexport default harnessEslint({ root: import.meta.dirname${workspace.next ? ", next: true" : ""} });\n`,
    lines: (workspace) => eslintPresetLines(workspace.path, workspace.next),
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
    marker: "harnessKnip(",
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
  if (fs.readFileSync(path.join(dir, own), "utf8").includes(tool.marker))
    return { target: label(workspace, own), status: "unchanged", detail: "uses the harness preset" };
  const lines = tool.lines(workspace).map((line) => `\n    ${line}`);
  return { target: label(workspace, own), status: "kept", detail: `your config stays; add the harness preset to it:${lines.join("")}` };
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

/** Appends the entries an ignore file lacks, keeping its lines; `isMissing` decides with the file as it stands. */
function ignoreFileStep(root: string, target: string, entries: readonly string[], isMissing: (entry: string, current: string) => boolean): Step {
  const file = path.join(root, target);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = entries.filter((entry) => isMissing(entry, current));
  if (missing.length === 0) return { target, status: "unchanged", detail: entries.join(", ") };
  const text = `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`;
  return { target, status: current === "" ? "created" : "updated", detail: missing.join(", "), apply: writer(file, text) };
}

function gitignoreStep(root: string, workspace: WorkspaceEntry): Step {
  return ignoreFileStep(
    root,
    label(workspace, ".gitignore"),
    IGNORED,
    (entry) => spawnSync("git", ["check-ignore", "-q", "--no-index", label(workspace, entry)], { cwd: root, stdio: "ignore" }).status !== 0,
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
    gitignoreStep(root, workspace),
    prettierignoreStep(root, workspace),
    ...(starter && workspace.shape === "next-modules" ? starterSteps(root, workspace, "next-modules", "src/shared/lib") : []),
    ...(starter && browser ? starterSteps(root, workspace, "e2e", "e2e") : []),
  ];
}

const manifest = z.object({ peerDependencies: z.record(z.string(), z.string()).optional() });

/** The install line for peer tools no folder between the workspace and the git root provides; init does not install. */
export function peerHint(root: string, workspace: WorkspaceEntry): string | undefined {
  const { peerDependencies = {} } = manifest.parse(JSON.parse(fs.readFileSync(path.join(HARNESS, "package.json"), "utf8")));
  const reachable = (name: string): boolean => {
    for (let dir = path.join(root, workspace.path); ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "node_modules", name, "package.json"))) return true;
      if (path.relative(root, dir) === "") return false;
    }
  };
  const missing = Object.entries(peerDependencies).filter(([name]) => !reachable(name));
  if (missing.length === 0) return undefined;
  const command = `pnpm add -D ${missing.map(([name, version]) => `${name}@${version}`).join(" ")}`;
  return `Install the harness's tools (init does not install): ${workspace.path === "" ? command : `cd ${workspace.path} && ${command}`}`;
}
