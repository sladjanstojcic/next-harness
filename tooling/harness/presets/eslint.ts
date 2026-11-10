import { TOOL_CONFIG_NAMES } from "../shapes/tool-config-names.ts";
import { harnessRuleBlocks } from "./eslint-rules.ts";
import { call, defaultOf, isRecord, list, member, toolLoader } from "./load-tool.ts";

const VENDORED = ["src/shared/ui/**", "src/shared/lib/utils.ts"];

/** The TypeScript tool configs at a workspace top; a consumer's tsconfig leaves them out, so they are linted without types. */
const CONFIG_FILES = Object.values(TOOL_CONFIG_NAMES)
  .flat()
  .filter((name) => name.endsWith(".ts"));

export interface HarnessEslintOptions {
  /** The workspace folder holding tsconfig.json, for typed rules; ESLint and its plugins load from there. */
  root: string;
  /** Adds the Next.js core-web-vitals and TypeScript configs. */
  next?: boolean;
  /**
   * False when the project's own config already brings ESLint's recommended rules, the TypeScript parser and plugin, and
   * any Next configs: the preset then adds only the harness's blocks, so no plugin is defined twice.
   */
  base?: boolean;
  /** Generated files the rules skip; the next-modules vendored paths by default. */
  vendored?: string[];
  /** A consumer leaves the vendored harness, which its tsconfig excludes, unlinted; the harness's own repository lints it. */
  harness?: "lint" | "ignore";
}

/** One flat-config entry, as far as the harness reads it. */
export interface EslintEntry {
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

const isEntry = (value: unknown): value is EslintEntry => isRecord(value) && (value.plugins === undefined || isRecord(value.plugins));

/** The harness's ESLint rules for a next-modules workspace; a project with its own config appends these after its entries. */
export function harnessEslint({ root, next = false, base = true, vendored = VENDORED, harness = "ignore" }: HarnessEslintOptions): EslintEntry[] {
  const tool = toolLoader(root);
  const eslint = tool("eslint/config");
  const tseslint = defaultOf(tool("typescript-eslint"));
  const disableTypeChecked = member(member(tseslint, "configs"), "disableTypeChecked");
  const parserOptions = { projectService: true, tsconfigRootDir: root };
  const ignored = [...vendored, ...(harness === "ignore" ? ["tooling/harness/**"] : [])];
  const recommended = (): unknown[] => [
    member(member(defaultOf(tool("@eslint/js")), "configs"), "recommended"),
    ...(next
      ? [...list(defaultOf(tool("eslint-config-next/core-web-vitals"))), ...list(defaultOf(tool("eslint-config-next/typescript")))]
      : list(member(member(tseslint, "configs"), "recommended"))),
  ];
  const entries = [
    call(member(eslint, "globalIgnores"), [[...ignored, ".next/**", "next-env.d.ts", "out/**", "build/**", ".superpowers/**", ".serena/**"]]),
    ...(base ? recommended() : []),
    ...harnessRuleBlocks().map((block, index) =>
      index === 0
        ? {
            ...block,
            languageOptions: base ? { parser: member(tseslint, "parser"), parserOptions } : { parserOptions },
            linterOptions: { noInlineConfig: true },
          }
        : block,
    ),
    ...(harness === "ignore" && isRecord(disableTypeChecked) ? [{ ...disableTypeChecked, files: CONFIG_FILES }] : []),
    ...(process.env.HARNESS_FAST_LINT === "1" ? [disableTypeChecked] : []),
    defaultOf(tool("eslint-config-prettier/flat")),
  ];
  return list(call(member(eslint, "defineConfig"), [entries])).filter(isEntry);
}
