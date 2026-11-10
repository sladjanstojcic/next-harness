import { createRequire } from "node:module";
import path from "node:path";

/**
 * Prints as one JSON object the ESLint config the working folder gives each path after the first argument (null for an
 * ignored path) and each configured rule's default options. The first argument is the workspace's ESLint binary; the
 * package loads from there, since the harness does not depend on ESLint.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const [binary = path.join(process.cwd(), "node_modules/.bin/eslint"), ...probes] = process.argv.slice(2);
const load = createRequire(binary);

function loadEslint(request: string): unknown {
  try {
    return load(request);
  } catch (error) {
    throw new Error(`eslint not found from ${binary}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

const eslint = loadEslint("eslint");
if (!isRecord(eslint) || typeof eslint.ESLint !== "function") throw new Error("The eslint package has no ESLint class.");
const internals = loadEslint("eslint/use-at-your-own-risk");
const builtinRules = isRecord(internals) && internals.builtinRules instanceof Map ? internals.builtinRules : new Map<unknown, unknown>();
const linter: unknown = Reflect.construct(eslint.ESLint, [{ cwd: process.cwd() }]);
if (!isRecord(linter) || typeof linter.calculateConfigForFile !== "function") throw new Error("ESLint cannot calculate a file's config.");

/** A rule's `meta.defaultOptions`, which ESLint merges into the options it prints; none means it prints them as given. */
function defaultOptions(config: Record<string, unknown>, rule: string): unknown {
  const split = rule.lastIndexOf("/");
  const plugin = split === -1 ? undefined : config.plugins;
  const rules = isRecord(plugin) ? plugin[rule.slice(0, split)] : undefined;
  const definition: unknown = split === -1 ? builtinRules.get(rule) : isRecord(rules) && isRecord(rules.rules) ? rules.rules[rule.slice(split + 1)] : undefined;
  return isRecord(definition) && isRecord(definition.meta) && Array.isArray(definition.meta.defaultOptions) ? definition.meta.defaultOptions : [];
}

const configs: Record<string, unknown> = {};
const defaults: Record<string, unknown> = {};
for (const probe of probes) {
  const config: unknown = await Reflect.apply(linter.calculateConfigForFile, linter, [probe]);
  configs[probe] = config ?? null;
  if (!isRecord(config) || !isRecord(config.rules)) continue;
  for (const rule of Object.keys(config.rules)) if (!(rule in defaults)) defaults[rule] = defaultOptions(config, rule);
}
process.stdout.write(`${JSON.stringify({ configs, defaults })}\n`);
