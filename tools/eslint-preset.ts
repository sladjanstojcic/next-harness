import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { WorkspaceEntry } from "../config.ts";
import type { Finding } from "../core/audit/finding.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";
import { harnessRuleBlocks, type PresetLayout, type RuleBlock } from "../presets/eslint-rules.ts";
import { SOURCE_PROBES } from "../shapes/next-modules.ts";
import { PACKAGE_PROBES } from "../shapes/package.ts";
import { TOOL_CONFIG_NAMES } from "../shapes/tool-config-names.ts";
import { bin, CHECK_TIMEOUT_MS } from "./tool-set.ts";

type Options = readonly unknown[];
/** What the preset and its check read of a workspace. */
export type PresetWorkspace = Pick<WorkspaceEntry, "path" | "shape" | "next">;

const layoutOf = (workspace: PresetWorkspace): PresetLayout => (workspace.shape === "package" ? "package" : "app");
type Setting = RuleBlock["rules"][string];

const severity = z.union([z.number(), z.string()]);
const ruleSetting = z.union([severity, z.tuple([severity], z.unknown())]);
const runnerOutput = z.object({ configs: z.record(z.string(), z.unknown()), defaults: z.record(z.string(), z.array(z.unknown())) });
const printedConfig = z.object({
  linterOptions: z.object({ noInlineConfig: z.boolean().optional() }).optional(),
  rules: z.record(z.string(), ruleSetting).optional(),
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const selectors = (options: Options): unknown[] => options.map((option) => (isRecord(option) ? option.selector : option));

/** The settings the preset gives a path: every block whose files match it and whose ignores do not, later blocks winning. */
export function expectedRules(probe: string, layout: PresetLayout = "app"): Record<string, Setting> {
  const matches = (globs: readonly string[] = []): boolean => globs.some((glob) => path.posix.matchesGlob(probe, glob));
  const settings: Record<string, Setting> = {};
  for (const block of harnessRuleBlocks(layout)) if (matches(block.files) && !matches(block.ignores)) Object.assign(settings, block.rules);
  return settings;
}

/** An option the preset sets must hold in the printed config; ESLint adds the rule's defaults to the object options it prints. */
const covers = (wanted: unknown, actual: unknown): boolean =>
  isRecord(wanted)
    ? isRecord(actual) && Object.entries(wanted).every(([key, value]) => isDeepStrictEqual(actual[key], value))
    : isDeepStrictEqual(actual, wanted);

/**
 * Whether a printed setting keeps the rule at error with the preset's options; a stricter line limit or more selectors
 * also pass. A rule the preset sets without options must print the rule's own defaults, so no option relaxes it.
 */
function holds(rule: string, expected: Setting, actual: z.infer<typeof ruleSetting> | undefined, defaults: Options): boolean {
  if (expected === "off") return true;
  const [, ...wanted] = Array.isArray(expected) ? expected : [expected];
  const [level, ...options] = Array.isArray(actual) ? actual : [actual];
  if (level !== 2 && level !== "error") return false;
  if (rule === "max-lines") {
    const [limit] = options;
    const max = isRecord(wanted[0]) ? wanted[0].max : undefined;
    if (typeof max !== "number") return false;
    if (typeof limit === "number") return limit <= max;
    return isRecord(limit) && typeof limit.max === "number" && limit.max <= max && limit.skipBlankLines !== true && limit.skipComments !== true;
  }
  if (rule === "no-restricted-syntax") return selectors(wanted).every((selector) => selectors(options).includes(selector));
  if (wanted.length === 0) return isDeepStrictEqual(options, defaults);
  return wanted.every((option, index) => covers(option, options[index]));
}

/** A probe name: 3 to 24 lowercase letters, with a hyphen inside about half of them and a digit in about half. */
export function probeToken(): string {
  const characters = Array.from({ length: randomInt(3, 25) }, () => String.fromCharCode(97 + randomInt(26)));
  if (randomInt(2) === 1) characters[randomInt(1, characters.length - 1)] = "-";
  if (randomInt(2) === 1) {
    const at = randomInt(characters.length);
    characters[characters[at] === "-" ? 0 : at] = String(randomInt(10));
  }
  return characters.join("");
}

/** The relative import of a preset file from a workspace folder, with the harness at tooling/harness/. */
export function presetImport(workspacePath: string, file: string): string {
  const up = workspacePath === "" ? "./" : "../".repeat(workspacePath.split("/").length);
  return `${up}tooling/harness/presets/${file}`;
}

/**
 * A config that brings the Next configs, Next's plugin or typescript-eslint itself takes only the harness's blocks; ESLint
 * refuses a plugin defined twice. Comments do not count.
 */
const OWN_BASE = /eslint-config-next|@next\/eslint-plugin-next|typescript-eslint/;
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm;

const bringsBase = (ownConfig: string): boolean => OWN_BASE.test(ownConfig.replace(COMMENTS, "$1"));

/** The preset call for a workspace; a project's own config that brings the base configs takes only the harness's blocks. */
export function presetCall(workspace: PresetWorkspace, ownConfig = ""): string {
  const layout = workspace.shape === "package" ? ', layout: "package"' : "";
  const base = bringsBase(ownConfig) ? ", base: false" : workspace.next ? ", next: true" : "";
  return `harnessEslint({ root: import.meta.dirname${layout}${base} })`;
}

/** The two lines that put the harness's ESLint rules after the entries of a project's own config, given that config's text. */
export function eslintPresetLines(workspace: PresetWorkspace, ownConfig: string): string[] {
  return [`import { harnessEslint } from "${presetImport(workspace.path, "eslint.ts")}";`, `...${presetCall(workspace, ownConfig)},`];
}

/** The text of the ESLint config in a workspace folder, or "" when it has none. */
function eslintConfigText(dir: string): string {
  const name = TOOL_CONFIG_NAMES.eslint.find((candidate) => fs.existsSync(path.join(dir, candidate)));
  return name === undefined ? "" : fs.readFileSync(path.join(dir, name), "utf8");
}

/** Whether the workspace's own ESLint config brings the base configs, so the preset's base packages are not needed there. */
export const bringsOwnBase = (dir: string): boolean => bringsBase(eslintConfigText(dir));

function missingRules(printed: unknown, probe: string, layout: PresetLayout, defaults: Record<string, Options>): string[] {
  const config = printedConfig.parse(printed ?? {});
  const missing = Object.entries(expectedRules(probe, layout))
    .filter(([rule, expected]) => !holds(rule, expected, config.rules?.[rule], defaults[rule] ?? []))
    .map(([rule]) => rule);
  return config.linterOptions?.noInlineConfig === true ? missing : [...missing, "linterOptions.noInlineConfig"];
}

function presetFindings(stdout: string, probes: string[], workspace: PresetWorkspace, presetLines: string[]): Finding[] {
  const { configs, defaults } = runnerOutput.parse(JSON.parse(stdout));
  const where = workspace.path === "" ? "the root" : workspace.path;
  const lines = presetLines.map((line) => `  ${line}`).join("\n");
  return probes.flatMap((probe) =>
    missingRules(configs[probe], probe, layoutOf(workspace), defaults).map((rule) => ({
      rule: "preset-missing",
      file: "",
      message: `${rule} is not active as the harness sets it for ${probe} in the ESLint config of ${where}. Keep your config and add the harness preset: put the first line at the top and the second as the last entry of the exported array, with no later entry weakening these rules.\n${lines}`,
    })),
  );
}

/** Resolves every probe's config in one Node process with the ESLint package beside the workspace's ESLint binary. */
export const CONFIG_RUNNER = path.join(import.meta.dirname, "eslint-config-runner.ts");

/**
 * One step for every probe path the workspace's shape derives, each under a fresh random name so a config cannot leave
 * the probes out by name: its effective ESLint config must hold every rule the preset sets there, with its options.
 */
export function eslintPreset(dir: string, workspace: PresetWorkspace, token: () => string = probeToken): ToolStep {
  const templates = workspace.shape === "package" ? PACKAGE_PROBES : SOURCE_PROBES;
  const probes = templates.map((template) => template.replaceAll("{name}", token()));
  return {
    name: "eslint-preset",
    command: [process.execPath, CONFIG_RUNNER, bin(dir, "eslint"), ...probes],
    cwd: dir,
    timeoutMs: CHECK_TIMEOUT_MS,
    findings: (stdout) => presetFindings(stdout, probes, workspace, eslintPresetLines(workspace, eslintConfigText(dir))),
  };
}
