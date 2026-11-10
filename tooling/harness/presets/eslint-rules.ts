/** The harness rule options the preset sets and the presence check compares; no ESLint import, so the gates can read them. */
import { MAX_FILE_LINES } from "../shapes/limits.ts";

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
export const doubleCast = {
  selector: "TSAsExpression > TSAsExpression",
  message: "Validate unknown data before using it; unavoidable adapter casts belong in src/modules/<module>/server/.",
};
export const workarounds = [namedExports, neverCast, computedImport, requireCall];

const BAN_TS_COMMENT = { "ts-check": true, "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true };

type Setting = "error" | "off" | ["error", ...unknown[]];

export interface RuleBlock {
  files: string[];
  ignores?: string[];
  rules: Record<string, Setting>;
}

/**
 * The harness's own rules, block by block in the preset's order: the preset spreads them into its config, and the
 * presence check folds the blocks matching a probe path into the settings that path must have.
 */
export function harnessRuleBlocks(): RuleBlock[] {
  return [
    {
      files: ["**/*.{ts,tsx}"],
      rules: {
        "@typescript-eslint/ban-ts-comment": ["error", BAN_TS_COMMENT],
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
  ];
}
