import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";
import { harnessRuleBlocks } from "./eslint-rules.ts";

const VENDORED = ["src/shared/ui/**", "src/shared/lib/utils.ts"];

export interface HarnessEslintOptions {
  /** The workspace folder holding tsconfig.json, for typed rules. */
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

/** The harness's ESLint rules for a next-modules workspace; a project with its own config appends these after its entries. */
export function harnessEslint({ root, next = false, base = true, vendored = VENDORED, harness = "ignore" }: HarnessEslintOptions) {
  const parserOptions = { projectService: true, tsconfigRootDir: root };
  const ignored = [...vendored, ...(harness === "ignore" ? ["tooling/harness/**"] : [])];
  return defineConfig([
    globalIgnores([...ignored, ".next/**", "next-env.d.ts", "out/**", "build/**", ".superpowers/**", ".serena/**"]),
    ...(base ? [js.configs.recommended, ...(next ? [...nextVitals, ...nextTs] : tseslint.configs.recommended)] : []),
    ...harnessRuleBlocks().map((block, index) =>
      index === 0
        ? {
            ...block,
            languageOptions: base ? { parser: tseslint.parser, parserOptions } : { parserOptions },
            linterOptions: { noInlineConfig: true },
          }
        : block,
    ),
    ...(process.env.HARNESS_FAST_LINT === "1" ? [tseslint.configs.disableTypeChecked] : []),
    prettier,
  ]);
}
