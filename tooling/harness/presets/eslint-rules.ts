/** The harness rule options the preset sets and the presence check compares; no ESLint import, so the gates can read them. */
import { builtinModules } from "node:module";
import { MAX_FILE_LINES } from "../shapes/limits.ts";

/**
 * Where the workspace keeps its code: an app's src/modules/ and src/shared/, the same folders at the top of an app
 * without src/ ("app-root"), or a shared package's src/.
 */
export type PresetLayout = "app" | "app-root" | "package";

/** The folder that may hold adapter casts, as the messages name it and as the rule blocks match it. */
const ADAPTERS: Record<PresetLayout, string> = { app: "src/modules/<module>/server/", "app-root": "modules/<module>/server/", package: "src/server/" };
const ADAPTER_GLOBS: Record<PresetLayout, string> = { app: "src/modules/*/server/**", "app-root": "modules/*/server/**", package: "src/server/**" };

const namedExports = {
  selector: "ExportAllDeclaration",
  message: "List named exports in index.ts or server.ts; place implementations in the module's components/, domain/ or server/.",
};

const neverCastIn = (layout: PresetLayout) => ({
  selector: "TSAsExpression > TSNeverKeyword.typeAnnotation",
  message: `Fix the type instead of casting to never; an unavoidable adapter cast belongs in ${ADAPTERS[layout]}.`,
});
const computedImport = {
  selector: "ImportExpression[source.type!='Literal']",
  message: "Import with a literal path so dependency-cruiser sees the module; choose between modules with a static map of imports.",
};
const requireCall = {
  selector: "CallExpression[callee.name='require']",
  message: "Use import; require() hides the dependency from the import boundaries.",
};
const doubleCastIn = (layout: PresetLayout) => ({
  selector: "TSAsExpression > TSAsExpression",
  message: `Validate unknown data before using it; unavoidable adapter casts belong in ${ADAPTERS[layout]}.`,
});
const workaroundsIn = (layout: PresetLayout) => [namedExports, neverCastIn(layout), computedImport, requireCall];
export const doubleCast = doubleCastIn("app");
export const workarounds = workaroundsIn("app");

/**
 * A package runs no dependency-cruiser, so its domain purity is a lint rule: no React, Next, Node built-in, server-only,
 * components/ or server code in src/domain/. Tests are exempt, as in an app.
 */
const PACKAGE_DOMAIN: RuleBlock = {
  files: ["src/domain/**/*.ts"],
  ignores: ["**/*.test.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [...builtinModules, "server-only"],
        patterns: [
          {
            regex: "^(?:node:|(?:react|react-dom|next)(?:/|$))|(?:^|/)(?:components|server)(?:/|\\.(?:js|ts)x?$|$)",
            message: "Keep src/domain/ pure: put React UI in src/components/ and Node, Next or I/O code in src/server/ (package layout).",
          },
        ],
      },
    ],
  },
};

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
export function harnessRuleBlocks(layout: PresetLayout = "app"): RuleBlock[] {
  const [workarounds, neverCast, doubleCast] = [workaroundsIn(layout), neverCastIn(layout), doubleCastIn(layout)];
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
      ignores: [ADAPTER_GLOBS[layout]],
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
    layout === "package"
      ? PACKAGE_DOMAIN
      : { files: ["tooling/**", "scripts/**", `${layout === "app" ? "src/" : ""}shared/lib/log.ts`], rules: { "no-console": "off" } },
  ];
}
