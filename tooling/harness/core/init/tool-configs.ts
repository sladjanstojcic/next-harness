import fs from "node:fs";
import path from "node:path";
import { sourcePaths, sourceRootOf, type WorkspaceEntry } from "../../config.ts";
import { TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { JSCPD_CACHE } from "../../tools/analysis.ts";
import { eslintPresetLines, exportedName, exportsCall, presetCall, presetImport } from "../../tools/eslint-preset.ts";
import { isObject, readJson, starterSteps, writer, type Step } from "./files.ts";
import { BUNDLE_IGNORED, developsHarness, gitignoreStep, HARNESS_MODULES, IGNORED, prettierIgnored, ignoreEntriesStep } from "./ignore-files.ts";
import { checksByProject, typecheckProjects } from "../../tools/typescript.ts";
import { tsconfigSteps } from "./tsconfig-step.ts";
import { viteVitestText } from "./vite/vite-steps.ts";

interface ToolConfig {
  /** The names the tool reads its config from, init's own first; a project's own config is never replaced. */
  names: readonly string[];
  /** Text that shows a config already uses the preset. */
  marker: string;
  text(workspace: WorkspaceEntry): string;
  /** Where the lines go in a config with the given text, when the lines do not say it themselves. */
  placement?(own: string): string;
  /** The lines that add the preset to a project's own config, given its text and the workspace folder; none when a kept config needs nothing. */
  lines?(workspace: WorkspaceEntry, own: string, dir: string): string[];
  /** A package.json key that also holds this tool's config. */
  packageKey?: string;
}

const ESLINT: ToolConfig = {
  names: TOOL_CONFIG_NAMES.eslint,
  marker: "harnessEslint(",
  text: (workspace) => `import { harnessEslint } from "${presetImport(workspace.path, "eslint.ts")}";\n\nexport default ${presetCall(workspace)};\n`,
  placement: (own) => {
    const name = exportedName(own);
    const spread = exportsCall(own) ? "the spread as the last argument of the exported call" : "the spread as the last element of the exported array";
    const second = name === undefined ? spread : `the other two lines in place of \`export default ${name}\``;
    return `the import at the top of the file, ${second}`;
  },
  lines: eslintPresetLines,
};

/** A project's formatting style is its own: a kept Prettier config, in any form, needs nothing from the preset. */
const PRETTIER: ToolConfig = {
  names: TOOL_CONFIG_NAMES.prettier,
  marker: "presets/prettier.ts",
  text: (workspace) => `export { default } from "${presetImport(workspace.path, "prettier.ts")}";\n`,
  packageKey: "prettier",
};

const VITEST: ToolConfig = {
  names: TOOL_CONFIG_NAMES.vitest,
  marker: "harnessVitest(",
  text: (workspace) =>
    workspace.shape === "vite-spa"
      ? viteVitestText(workspace)
      : `import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";\n\nexport default harnessVitest();\n`,
  // An Electron project's own Vitest config holds its aliases and needs nothing from the preset.
  lines: (workspace) =>
    workspace.shape === "electron-vite"
      ? []
      : [
          `import { mergeConfig } from "vitest/config"; import { harnessVitest } from "${presetImport(workspace.path, "vitest.ts")}";`,
          "export default mergeConfig(harnessVitest(), yourConfig);",
        ],
};

const KNIP_PRESETS: Partial<Record<WorkspaceEntry["shape"], string>> = {
  package: "harnessKnipPackage",
  "electron-vite": "harnessKnipElectron",
  "vite-spa": "harnessKnipVite",
};
const knipPreset = (workspace: WorkspaceEntry): string => KNIP_PRESETS[workspace.shape] ?? "harnessKnip";
const CRUISER_PRESETS: Partial<Record<WorkspaceEntry["shape"], string>> = {
  package: "dependency-cruiser-package.json",
  "electron-vite": "dependency-cruiser-electron.json",
  "vite-spa": "dependency-cruiser-vite.json",
};

const KNIP: ToolConfig = {
  names: TOOL_CONFIG_NAMES.knip,
  marker: "harnessKnip",
  text: (workspace) => `import { ${knipPreset(workspace)} } from "${presetImport(workspace.path, "knip.ts")}";\n\nexport default ${knipPreset(workspace)}();\n`,
  lines: (workspace) => [
    `import { ${knipPreset(workspace)} } from "${presetImport(workspace.path, "knip.ts")}";`,
    `...${knipPreset(workspace)}(), // first in the exported object`,
  ],
};

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

/** The workspace's package.json as an object; an absent or unreadable one is empty. */
function packageJson(root: string, workspace: WorkspaceEntry): Record<string, unknown> {
  try {
    return readJson(path.join(root, workspace.path, "package.json"), "package.json") ?? {};
  } catch {
    return {};
  }
}

/**
 * The package script that runs the workspace's own tests: the one harness.config.ts names, else a `test` script that
 * does not run Vitest. The gates then run that script, so init writes no vitest.config.ts and asks for no Vitest.
 */
export function runsOwnTests(root: string, workspace: WorkspaceEntry): string | undefined {
  if (workspace.test !== undefined) return workspace.test;
  const { scripts } = packageJson(root, workspace);
  const test = isObject(scripts) ? scripts.test : undefined;
  return typeof test === "string" && !/\bvitest\b/.test(test) ? "test" : undefined;
}

type Found = { state: "absent" } | { state: "preset" | "own"; file: string; text: string };

function find(root: string, workspace: WorkspaceEntry, tool: ToolConfig): Found {
  const dir = path.join(root, workspace.path);
  const file = tool.names.find((name) => fs.existsSync(path.join(dir, name)));
  if (file === undefined) {
    const inPackage = tool.packageKey !== undefined && packageJson(root, workspace)[tool.packageKey] !== undefined;
    return inPackage ? { state: "own", file: "package.json", text: "" } : { state: "absent" };
  }
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  return { state: text.includes(tool.marker) ? "preset" : "own", file, text };
}

function toolConfigStep(root: string, workspace: WorkspaceEntry, tool: ToolConfig): Step {
  const found = find(root, workspace, tool);
  const file = tool.names[0] ?? "";
  if (found.state === "absent") {
    const apply = writer(path.join(root, workspace.path, file), tool.text(workspace));
    return { target: label(workspace, file), status: "created", detail: "harness preset", apply };
  }
  if (found.state === "preset") return { target: label(workspace, found.file), status: "unchanged", detail: "uses the harness preset" };
  const lines = (tool.lines?.(workspace, found.text, path.join(root, workspace.path)) ?? []).map((line) => `\n    ${line}`);
  if (lines.length === 0) return { target: label(workspace, found.file), status: "kept", detail: "your config stays as it is" };
  return {
    target: label(workspace, found.file),
    status: "kept",
    detail: `your config stays; add the harness preset to it${tool.placement === undefined ? "" : `, ${tool.placement(found.text)}`}:${lines.join("")}`,
    todo: true,
  };
}

/** An app has build output and vendored UI to ignore; a package has neither. */
const isApp = (workspace: WorkspaceEntry): boolean => workspace.shape !== "package";

/** The tools whose config a workspace gets: Vitest only where the gates run it, Playwright only for a Next workspace at the git root. */
function toolsOf(root: string, workspace: WorkspaceEntry): ToolConfig[] {
  const browser = workspace.path === "" && workspace.next;
  const vitest = runsOwnTests(root, workspace) === undefined ? [VITEST] : [];
  return [ESLINT, PRETTIER, ...vitest, KNIP, ...(browser ? [PLAYWRIGHT] : [])];
}

/** Whether the workspace formats with the harness's Prettier preset rather than a style of its own. */
export function usesPrettierPreset(root: string, workspace: WorkspaceEntry): boolean {
  return find(root, workspace, PRETTIER).state !== "own";
}

/**
 * The workspace's tool config files that import a preset, now or once the printed lines are added. The project's type
 * check must not follow them into the harness, so its tsconfig.json leaves them out.
 */
function presetConfigs(root: string, workspace: WorkspaceEntry): string[] {
  return toolsOf(root, workspace).flatMap((tool) => {
    const found = find(root, workspace, tool);
    if (found.state === "absent") return [tool.names[0] ?? ""];
    const kept = found.state === "own" && (tool.lines?.(workspace, found.text, path.join(root, workspace.path)) ?? []).length === 0;
    return kept ? [] : [found.file];
  });
}

function ownTestsStep(root: string, workspace: WorkspaceEntry): Step[] {
  const script = runsOwnTests(root, workspace);
  if (script === undefined) return [];
  const target = label(workspace, "package.json");
  if (workspace.test !== undefined) return [{ target, status: "unchanged", detail: `the gates run its "${script}" script; no Vitest config is written` }];
  return [{ target, status: "kept", detail: `its "${script}" script does not run Vitest; no Vitest config is written (see the next steps)` }];
}

function dependencyCruiserStep(root: string, workspace: WorkspaceEntry, force: boolean): Step {
  const target = label(workspace, ".dependency-cruiser.json");
  const file = path.join(root, target);
  const preset = CRUISER_PRESETS[workspace.shape] ?? "dependency-cruiser.json";
  const text = `{\n  "extends": "${presetImport(workspace.path, preset)}"\n}\n`;
  const apply = writer(file, text);
  if (!fs.existsSync(file)) return { target, status: "created", detail: "harness preset", apply };
  if (fs.readFileSync(file, "utf8") === text) return { target, status: "unchanged", detail: "harness preset" };
  if (!force) return { target, status: "conflict", detail: "holds other rules; --force replaces it with the harness preset" };
  return { target, status: "updated", detail: "replaced by the harness preset", apply };
}

/**
 * Scripts a workspace gets when it has none of that name; the root's harness scripts come from the wiring. Without src/
 * the analysis scripts name the source paths that exist in `dir` today, since both tools fail on a missing one, and
 * shared/ when this run's starter files are about to create it.
 */
export function toolScripts(workspace: WorkspaceEntry, dir = "", starter = false): Record<string, string> {
  const soon = starter && workspace.shape === "next-modules" ? ["shared"] : [];
  const projects = typecheckProjects(dir, workspace);
  const sources = sourceRootOf(workspace) === "" ? sourcePaths(dir, "", soon).join(" ") : "src";
  const analysis = {
    depcruise: `depcruise ${sources} --config .dependency-cruiser.json`,
    knip: "knip",
    jscpd: `jscpd ${sources} --config ${presetImport(workspace.path, "jscpd.json")}${checksByProject(workspace.shape) ? ` --output ${JSCPD_CACHE}` : ""}`,
  };
  return {
    lint: "eslint . --max-warnings 0",
    typecheck: workspace.next ? "next typegen && tsc --noEmit" : projects.map((project) => `tsc --noEmit -p ${project}`).join(" && ") || "tsc --noEmit",
    test: "vitest run",
    ...analysis,
    format: "prettier --write .",
  };
}

/** Tool config, ignore and starter steps of every eslint-prettier workspace; package scripts are the caller's, since the root file also takes the wiring scripts. */
export function toolConfigSteps(root: string, workspace: WorkspaceEntry, force: boolean, starter: boolean): Step[] {
  const browser = workspace.path === "" && workspace.next;
  const app = isApp(workspace);
  const bundled = workspace.shape === "electron-vite" || workspace.shape === "vite-spa";
  const ignored = [...(BUNDLE_IGNORED[workspace.shape] ?? IGNORED), ...(workspace.path === "" ? [HARNESS_MODULES] : [])];
  return [
    ...toolsOf(root, workspace).map((tool) => toolConfigStep(root, workspace, tool)),
    ...ownTestsStep(root, workspace),
    dependencyCruiserStep(root, workspace, force),
    ...tsconfigSteps(root, workspace, force, developsHarness(root) ? [] : presetConfigs(root, workspace)),
    ...(app ? [gitignoreStep(root, workspace.path, ignored)] : []),
    ...(workspace.path === "" || !app ? [] : [ignoreEntriesStep(root, label(workspace, ".prettierignore"), prettierIgnored(workspace))]),
    ...(starter && workspace.shape === "next-modules" ? starterSteps(root, "next-modules", label(workspace, `${sourceRootOf(workspace)}shared/lib`)) : []),
    ...(starter && browser ? starterSteps(root, "e2e", label(workspace, "e2e")) : []),
    ...(starter && bundled
      ? [
          {
            target: label(workspace, "src"),
            status: "unchanged" as const,
            detail: `--starter writes nothing here: the ${workspace.shape} shape has no starter files`,
          },
        ]
      : []),
  ];
}
