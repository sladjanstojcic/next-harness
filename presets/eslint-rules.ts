/** The harness rule options the preset sets and the presence check compares; no ESLint import, so the gates can read them. */
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { MAX_FILE_LINES } from "../shapes/limits.ts";
import type { ElectronAliases } from "./electron-aliases.ts";

export type { ElectronAliases };
import { electronBoundaryBlocks } from "./eslint-boundaries/electron.ts";
import { viteBoundaryBlocks } from "./eslint-boundaries/vite.ts";
import { ADAPTER_GLOBS, ADAPTERS, CONSOLE, hasLog, UI, withUi, type PresetLayout } from "./eslint-layouts.ts";
import { nodeBoundaryBlocks } from "./eslint-boundaries/node.ts";

export type { PresetLayout };

/** Test code has no adapter folder: a page object is code, so no file is exempt from the cast rules. */
const NO_ADAPTER = "test code has no adapter folder for such a cast (e2e layout)";
/** no-console has one fixed message, so in an Electron app the same ban is a rule that says where logging belongs. */
const ELECTRON_CONSOLE = {
  object: "console",
  message: "Log through a file named log.ts in a src/main/ area folder (src/main/logging/log.ts), the one place console is allowed (Electron layout).",
};

const namedExports = {
  selector: "ExportAllDeclaration",
  message: "List named exports in index.ts or server.ts; place implementations in the module's components/, domain/ or server/.",
};

const neverCastIn = (layout: PresetLayout) => ({
  selector: "TSAsExpression > TSNeverKeyword.typeAnnotation",
  message:
    layout === "e2e"
      ? `Fix the type instead of casting to never; ${NO_ADAPTER}.`
      : `Fix the type instead of casting to never; an unavoidable adapter cast belongs in ${ADAPTERS[layout]}.`,
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
  message:
    layout === "e2e"
      ? `Validate unknown data before using it; ${NO_ADAPTER}.`
      : `Validate unknown data before using it; unavoidable adapter casts belong in ${ADAPTERS[layout]}.`,
});
/** Whether a workspace is set up for shadcn: `components.json` at its top. The preset, its check and the code index all ask here. */
export const usesShadcn = (workspaceDir: string): boolean => fs.existsSync(path.join(workspaceDir, "components.json"));

/** The raw elements shadcn has a component for under the same name. */
export const RAW_CONTROLS: readonly string[] = ["button", "input", "select", "textarea", "label", "table", "dialog"];
/** One selector per element, so the message names the component to use; none in a workspace without shadcn. */
const rawControlsIn = (layout: PresetLayout, shadcn: boolean): { selector: string; message: string }[] =>
  !shadcn || !withUi(layout)
    ? []
    : RAW_CONTROLS.map((element) => ({
        selector: `JSXOpeningElement[name.type='JSXIdentifier'][name.name='${element}']`,
        message: `Use the shadcn component from ${UI[layout]} instead of a raw <${element}>; add a missing one with \`pnpm dlx shadcn add ${element}\`. If shadcn has no component for this, say so in the handoff before building it by hand.`,
      }));

/** A cast on require's result goes unchecked: TypeScript infers a generic require's type from the cast itself. */
const requireCast = {
  selector: "TSAsExpression > CallExpression[callee.name='require']",
  message: 'Give require its type instead of casting its result: require<typeof import("./<area>/<name>.js")>(...) (PocketBase layout).',
};
/** In a PocketBase backend require() is the module system, and the shape's own rule judges where it sits. */
const requireBanIn = (layout: PresetLayout) => [layout === "pocketbase" ? requireCast : requireCall];
const requireImportsIn = (layout: PresetLayout): RuleBlock["rules"] => (layout === "pocketbase" ? { "@typescript-eslint/no-require-imports": "off" } : {});
const workaroundsIn = (layout: PresetLayout) => [namedExports, neverCastIn(layout), computedImport, ...requireBanIn(layout)];
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

const consoleExemptionIn = (layout: PresetLayout): RuleBlock[] => (hasLog(layout) ? [{ files: CONSOLE[layout], rules: { "no-console": "off" } }] : []);

const ELECTRON_CONSOLE_BLOCK: RuleBlock = {
  files: ["**/*.{ts,tsx}"],
  ignores: CONSOLE.electron,
  rules: { "no-console": "off", "no-restricted-properties": ["error", ELECTRON_CONSOLE] },
};
/** Preload and renderer may not import the main process's log helper, so their message does not send them there. */
const ELECTRON_CONSOLE_OUTSIDE_MAIN: RuleBlock = {
  files: ["src/{preload,renderer}/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-properties": [
      "error",
      {
        object: "console",
        message:
          "Do not log here: let the error throw, or send it to the main process over a channel; console is allowed only in a file named log.ts in a src/main/ area folder (Electron layout).",
      },
    ],
  },
};

/**
 * The preset registers eslint-plugin-react-hooks under a name of its own. ESLint refuses two different plugin objects
 * under one name, and a project's config, or eslint-config-next, may hold another copy under `react-hooks`.
 */
export const HOOKS_PLUGIN = "harness-react-hooks";
/** Both hook rules as errors, and the project's two of the same kind off, so each finding is reported once. */
export const HOOK_RULES: RuleBlock["rules"] = {
  [`${HOOKS_PLUGIN}/rules-of-hooks`]: "error",
  [`${HOOKS_PLUGIN}/exhaustive-deps`]: "error",
  "react-hooks/rules-of-hooks": "off",
  "react-hooks/exhaustive-deps": "off",
};
/**
 * Where React code can sit: in an Electron app the renderer alone, elsewhere every TypeScript file but browser tests
 * and automation, where a Playwright fixture's `use` and a script's `use…` function are no hooks. A PocketBase backend
 * and a Node service run no React, and in a Playwright suite a fixture's `use` is no hook.
 */
const hooksIn = (layout: PresetLayout): RuleBlock[] => {
  if (layout === "pocketbase" || layout === "e2e" || layout === "service") return [];
  if (layout === "electron") return [{ files: ["src/renderer/**/*.{ts,tsx}"], rules: HOOK_RULES }];
  return [{ files: ["**/*.{ts,tsx}"], ignores: ["e2e/**", "scripts/**", "tooling/**"], rules: HOOK_RULES }];
};

/**
 * The harness's own rules, block by block in the preset's order: the preset spreads them into its config, and the
 * presence check folds the blocks matching a probe path into the settings that path must have. Each block that sets
 * no-restricted-syntax replaces the earlier one's options, so with `shadcn` every one of them carries the raw controls.
 */
export function harnessRuleBlocks(layout: PresetLayout = "app", aliases?: ElectronAliases, shadcn = false): RuleBlock[] {
  const [workarounds, neverCast, doubleCast] = [workaroundsIn(layout), neverCastIn(layout), doubleCastIn(layout)];
  const controls = rawControlsIn(layout, shadcn);
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
        "no-restricted-syntax": ["error", ...workarounds, ...controls],
        ...requireImportsIn(layout),
      },
    },
    {
      files: ["**/*.{ts,tsx}"],
      ...(layout === "e2e" ? {} : { ignores: [ADAPTER_GLOBS[layout]] }),
      rules: {
        "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
        "@typescript-eslint/no-unsafe-type-assertion": "error",
        "no-restricted-syntax": ["error", ...workarounds, doubleCast, ...controls],
      },
    },
    {
      // Tests load fixtures they just wrote and cast fixture data; the other workaround rules still apply.
      files: ["**/*.test.{ts,tsx}", ...(layout === "e2e" ? ["**/*.spec.ts", "**/*.setup.ts"] : [])],
      rules: {
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-unsafe-type-assertion": "off",
        "no-restricted-syntax": ["error", namedExports, neverCast, ...requireBanIn(layout), doubleCast, ...controls],
      },
    },
    ...(layout === "package" ? [PACKAGE_DOMAIN] : []),
    ...consoleExemptionIn(layout),
    ...hooksIn(layout),
    ...(layout === "electron" ? [ELECTRON_CONSOLE_BLOCK, ELECTRON_CONSOLE_OUTSIDE_MAIN, ...electronBoundaryBlocks(aliases)] : []),
    ...(layout === "spa" ? viteBoundaryBlocks() : []),
    ...(layout === "service" ? nodeBoundaryBlocks() : []),
  ];
}
