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
  /** Generated files the rules skip; the next-modules vendored paths by default. */
  vendored?: string[];
  /** A consumer leaves the vendored harness, which its tsconfig excludes, unlinted; the harness's own repository lints it. */
  harness?: "lint" | "ignore";
}

/** The harness's ESLint rules for a next-modules workspace; a project with its own config appends these after its entries. */
export function harnessEslint({ root, next = false, vendored = VENDORED, harness = "ignore" }: HarnessEslintOptions) {
  const ignored = [...vendored, ...(harness === "ignore" ? ["tooling/harness/**"] : [])];
  return defineConfig([
    globalIgnores([...ignored, ".next/**", "next-env.d.ts", "out/**", "build/**", ".superpowers/**", ".serena/**"]),
    js.configs.recommended,
    ...(next ? [...nextVitals, ...nextTs] : tseslint.configs.recommended),
    ...harnessRuleBlocks().map((block, index) =>
      index === 0
        ? {
            ...block,
            languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: root } },
            linterOptions: { noInlineConfig: true },
          }
        : block,
    ),
    ...(process.env.HARNESS_FAST_LINT === "1" ? [tseslint.configs.disableTypeChecked] : []),
    prettier,
  ]);
}
