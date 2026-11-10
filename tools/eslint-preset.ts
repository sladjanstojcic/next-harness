import { randomInt } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Finding } from "../core/audit/finding.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";
import { harnessRuleBlocks, type RuleBlock } from "../presets/eslint-rules.ts";
import { SOURCE_PROBES } from "../shapes/next-modules.ts";
import { bin, CHECK_TIMEOUT_MS } from "./tool-set.ts";

type Options = readonly unknown[];
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
export function expectedRules(probe: string): Record<string, Setting> {
  const matches = (globs: readonly string[] = []): boolean => globs.some((glob) => path.posix.matchesGlob(probe, glob));
  const settings: Record<string, Setting> = {};
  for (const block of harnessRuleBlocks()) if (matches(block.files) && !matches(block.ignores)) Object.assign(settings, block.rules);
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

/** The two lines that put the harness's ESLint rules after a project's own entries. */
export function eslintPresetLines(workspacePath: string, next: boolean): string[] {
  return [
    `import { harnessEslint } from "${presetImport(workspacePath, "eslint.ts")}";`,
    `...harnessEslint({ root: import.meta.dirname${next ? ", next: true" : ""} }),`,
  ];
}

function missingRules(printed: unknown, probe: string, defaults: Record<string, Options>): string[] {
  const config = printedConfig.parse(printed ?? {});
  const missing = Object.entries(expectedRules(probe))
    .filter(([rule, expected]) => !holds(rule, expected, config.rules?.[rule], defaults[rule] ?? []))
    .map(([rule]) => rule);
  return config.linterOptions?.noInlineConfig === true ? missing : [...missing, "linterOptions.noInlineConfig"];
}

function presetFindings(stdout: string, probes: string[], workspacePath: string, next: boolean): Finding[] {
  const { configs, defaults } = runnerOutput.parse(JSON.parse(stdout));
  const where = workspacePath === "" ? "the root" : workspacePath;
  const lines = eslintPresetLines(workspacePath, next)
    .map((line) => `  ${line}`)
    .join("\n");
  return probes.flatMap((probe) =>
    missingRules(configs[probe], probe, defaults).map((rule) => ({
      rule: "preset-missing",
      file: "",
      message: `${rule} is not active as the harness sets it for ${probe} in the ESLint config of ${where}. Keep your config and add the harness preset: put the first line at the top and the second as the last entry of the exported array, with no later entry weakening these rules.\n${lines}`,
    })),
  );
}

/** Resolves every probe's config in one Node process with the ESLint package beside the workspace's ESLint binary. */
export const CONFIG_RUNNER = path.join(import.meta.dirname, "eslint-config-runner.ts");

/**
 * One step for every probe path the next-modules shape derives, each under a fresh random name so a config cannot leave
 * the probes out by name: its effective ESLint config must hold every rule the preset sets there, with its options.
 */
export function eslintPreset(dir: string, workspacePath: string, next: boolean, token: () => string = probeToken): ToolStep {
  const probes = SOURCE_PROBES.map((template) => template.replaceAll("{name}", token()));
  return {
    name: "eslint-preset",
    command: [process.execPath, CONFIG_RUNNER, bin(dir, "eslint"), ...probes],
    cwd: dir,
    timeoutMs: CHECK_TIMEOUT_MS,
    findings: (stdout) => presetFindings(stdout, probes, workspacePath, next),
  };
}
