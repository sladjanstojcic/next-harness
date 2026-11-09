import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";
import { MAX_FILE_LINES } from "./tooling/harness/structure.ts";

const namedExports = {
  selector: "ExportAllDeclaration",
  message: "List named exports in index.ts or server.ts; place implementations in the module's components/, domain/ or server/.",
};

const neverCast = {
  selector: "TSAsExpression > TSNeverKeyword.typeAnnotation",
  message: "Fix the type instead of casting to never; an unavoidable adapter cast belongs in src/modules/<module>/server/.",
};
const computedImport = {
  selector: "ImportExpression[source.type!='Literal']",
  message: "Import with a literal path so dependency-cruiser sees the module; choose between modules with a static map of imports.",
};
const requireCall = {
  selector: "CallExpression[callee.name='require']",
  message: "Use import; require() hides the dependency from the import boundaries.",
};
const doubleCast = {
  selector: "TSAsExpression > TSAsExpression",
  message: "Validate unknown data before using it; unavoidable adapter casts belong in src/modules/<module>/server/.",
};
const workarounds = [namedExports, neverCast, computedImport, requireCall];

export default defineConfig([
  globalIgnores(["src/shared/ui/**", "src/shared/lib/utils.ts", ".next/**", "next-env.d.ts", "out/**", "build/**", ".superpowers/**", ".serena/**"]),
  js.configs.recommended,
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    linterOptions: { noInlineConfig: true },
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-check": true, "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-console": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "max-lines": ["error", { max: MAX_FILE_LINES, skipBlankLines: false, skipComments: false }],
      "no-restricted-syntax": ["error", ...workarounds],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/modules/*/server/**"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "no-restricted-syntax": ["error", ...workarounds, doubleCast],
    },
  },
  {
    // Tests load fixtures they just wrote and cast fixture data; the other workaround rules still apply.
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "no-restricted-syntax": ["error", namedExports, neverCast, requireCall, doubleCast],
    },
  },
  { files: ["tooling/**", "scripts/**", "src/shared/lib/log.ts"], rules: { "no-console": "off" } },
  ...(process.env.HARNESS_FAST_LINT === "1" ? [tseslint.configs.disableTypeChecked] : []),
  prettier,
]);
