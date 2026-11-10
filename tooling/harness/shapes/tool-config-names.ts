const SCRIPT_EXTENSIONS = ["ts", "js", "mjs", "cjs", "mts", "cts"];

const named = (base: string, extensions: readonly string[] = SCRIPT_EXTENSIONS): string[] => extensions.map((extension) => `${base}.${extension}`);

/**
 * The config names each tool reads, init's own first. Init keeps any other as the project's own config; the
 * next-modules shape allows every name at a workspace top, and the lock covers every name in each
 * eslint-prettier workspace.
 */
export const TOOL_CONFIG_NAMES = {
  eslint: named("eslint.config"),
  prettier: [
    ...named("prettier.config"),
    ".prettierrc",
    ...named(".prettierrc", ["json", "json5", "yaml", "yml", "toml"]),
    ...named(".prettierrc", SCRIPT_EXTENSIONS),
  ],
  vitest: named("vitest.config"),
  knip: [...named("knip.config"), "knip.json", "knip.jsonc", ".knip.json", ".knip.jsonc", "knip.ts", "knip.js"],
  playwright: named("playwright.config"),
} satisfies Record<string, readonly string[]>;

export const ALL_TOOL_CONFIG_NAMES: readonly string[] = Object.values(TOOL_CONFIG_NAMES).flat();

/** The JavaScript-only names among them, which the TypeScript-everywhere rule must let through. */
export const JS_TOOL_CONFIG_NAMES: readonly string[] = ALL_TOOL_CONFIG_NAMES.filter((name) => /\.(?:js|mjs|cjs)$/.test(name));
