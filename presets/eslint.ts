import { TOOL_CONFIG_NAMES } from "../shapes/tool-config-names.ts";
import { electronAliases } from "./electron-aliases.ts";
import { harnessRuleBlocks, usesShadcn, type PresetLayout } from "./eslint-rules.ts";
import { call, defaultOf, isRecord, list, member, toolLoader } from "./load-tool.ts";

const VENDORED = ["shared/ui/**", "shared/lib/utils.ts"];
/** The folder that holds shared/, by layout. */
const VENDORED_ROOT: Record<PresetLayout, string> = { app: "src/", "app-root": "", package: "src/", electron: "src/renderer/src/" };

/** The TypeScript tool configs at a workspace top; a consumer's tsconfig leaves them out, so they are linted without types. */
const CONFIG_FILES = Object.values(TOOL_CONFIG_NAMES)
  .flat()
  .filter((name) => name.endsWith(".ts"));

export interface HarnessEslintOptions {
  /** The workspace folder holding tsconfig.json, for typed rules; ESLint and its plugins load from there. */
  root: string;
  /** "app-root" for an app without src/ (app/, modules/, shared/ at its top), "package" for a shared package, "electron" for an electron-vite app; an app's src/ layout by default. */
  layout?: PresetLayout;
  /** Adds the Next.js core-web-vitals and TypeScript configs. */
  next?: boolean;
  /**
   * False when the project's own config already brings ESLint's recommended rules, the TypeScript parser and plugin, and
   * any Next configs: the preset then adds only the harness's blocks, so no plugin is defined twice.
   */
  base?: boolean;
  /**
   * The package the project's own config takes its base from, such as `@repo/eslint-config`: a tool the workspace does not
   * install itself is loaded from there, so the preset runs the copies the project already runs.
   */
  toolsFrom?: string;
  /** Generated files the rules skip; the next-modules vendored paths of the layout by default. */
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

/** The harness's ESLint rules for a next-modules or package workspace; a project with its own config appends these after its entries. */
export function harnessEslint(options: HarnessEslintOptions): EslintEntry[] {
  const { root, layout = "app", next = false, base = true, harness = "ignore" } = options;
  const vendored = options.vendored ?? VENDORED.map((glob) => `${VENDORED_ROOT[layout]}${glob}`);
  // An Electron project's tsconfig projects name src/ and its own configs, so harness.config.ts is in none of them.
  const untyped = layout === "electron" ? [...CONFIG_FILES, "harness.config.ts"] : CONFIG_FILES;
  const tool = toolLoader(root, options.toolsFrom);
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
    call(member(eslint, "globalIgnores"), [
      [...ignored, ".next/**", "next-env.d.ts", "out/**", "build/**", ...(layout === "electron" ? ["dist/**"] : []), ".superpowers/**", ".serena/**"],
    ]),
    ...(base ? recommended() : []),
    ...harnessRuleBlocks(layout, layout === "electron" ? electronAliases(tool("typescript"), root) : undefined, usesShadcn(root)).map((block, index) =>
      index === 0
        ? {
            ...block,
            languageOptions: base ? { parser: member(tseslint, "parser"), parserOptions } : { parserOptions },
            linterOptions: { noInlineConfig: true },
          }
        : block,
    ),
    ...(harness === "ignore" && isRecord(disableTypeChecked) ? [{ ...disableTypeChecked, files: untyped }] : []),
    ...(process.env.HARNESS_FAST_LINT === "1" ? [disableTypeChecked] : []),
    defaultOf(tool("eslint-config-prettier/flat")),
  ];
  return list(call(member(eslint, "defineConfig"), [entries])).filter(isEntry);
}
