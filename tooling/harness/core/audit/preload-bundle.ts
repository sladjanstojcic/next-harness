import fs from "node:fs";
import { join, posix } from "node:path";
import { ELECTRON_LAYOUT } from "../../shapes/electron/source-rules.ts";
import { ts } from "../../tools/typescript.ts";
import { resolveHarness } from "../path-check.ts";
import type { Finding } from "./finding.ts";

const CONFIG = "electron.vite.config.ts";
/** The line that makes electron-vite bundle the packages a preload script imports; init prints it too. */
export const PRELOAD_BUNDLE_SETTING = "build: { externalizeDeps: false }";
const CANNOT_LOAD = 'a sandboxed preload script cannot load a package and electron-vite leaves every package in "dependencies" outside the bundle';
const MISSING = `The preload section does not set build.externalizeDeps to false. A sandboxed preload script cannot load a package, and electron-vite leaves every package in "dependencies" outside the bundle, so the window gets no bridge. Add to the preload section: ${PRELOAD_BUNDLE_SETTING} ${ELECTRON_LAYOUT}`;
const PLUGIN = `externalizeDepsPlugin() in the preload section's plugins keeps every package in "dependencies" outside the preload bundle, and a sandboxed preload script cannot load a package. Remove it from the preload section and keep ${PRELOAD_BUNDLE_SETTING} there ${ELECTRON_LAYOUT}`;
const unseen = (what: string): string =>
  `The rule could not see the setting: ${what} is not written out as an object literal. Write it literally, as preload: { ${PRELOAD_BUNDLE_SETTING} }, because ${CANNOT_LOAD} ${ELECTRON_LAYOUT}`;

export interface PreloadBundleProblem {
  line: number;
  message: string;
}

/** The expression inside parentheses, `as` and `satisfies`. */
function plain(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? plain(node.expression) : node;
}

/**
 * What an object literal gives a key, read in order as the object is built: the last assignment wins, and a spread, a
 * shorthand or a computed key after it hides the value, since the rule evaluates nothing.
 */
function valueOf(object: ts.ObjectLiteralExpression, key: string): ts.Expression | "absent" | "hidden" {
  let value: ts.Expression | "absent" | "hidden" = "absent";
  for (const member of object.properties) {
    const name = member.name;
    const named = name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
    if (ts.isPropertyAssignment(member) && named === key) value = plain(member.initializer);
    else if (named === key || (named === undefined && !ts.isPropertyAssignment(member)) || (name !== undefined && ts.isComputedPropertyName(name)))
      value = "hidden";
  }
  return value;
}

/** `export default defineConfig({ … })` or `export default { … }`; a function, a variable or a spread is not followed. */
function exportedConfig(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const exported = source.statements.find((statement) => ts.isExportAssignment(statement) && statement.isExportEquals !== true);
  if (exported === undefined || !ts.isExportAssignment(exported)) return undefined;
  const value = plain(exported.expression);
  const called = ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "defineConfig" ? value.arguments[0] : value;
  const config = called === undefined ? undefined : plain(called);
  return config !== undefined && ts.isObjectLiteralExpression(config) ? config : undefined;
}

/**
 * Whether electron-vite bundles the packages the preload script imports, read from the text of electron.vite.config.ts:
 * `build.externalizeDeps` is the literal `false` in the preload section and its plugins do not call
 * `externalizeDepsPlugin`. A config without a preload section builds no preload script and passes.
 */
export function preloadBundleProblems(text: string): PreloadBundleProblem[] {
  const source = ts.createSourceFile(CONFIG, text, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node, message: string): PreloadBundleProblem => ({
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    message,
  });
  const config = exportedConfig(source);
  if (config === undefined) return [{ line: 1, message: unseen("the exported config") }];
  const preload = valueOf(config, "preload");
  if (preload === "absent") return [];
  if (preload === "hidden" || !ts.isObjectLiteralExpression(preload)) return [at(config, unseen("the preload section"))];
  const problems: PreloadBundleProblem[] = [];
  const plugins = valueOf(preload, "plugins");
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "externalizeDepsPlugin") problems.push(at(node, PLUGIN));
    ts.forEachChild(node, visit);
  };
  if (typeof plugins !== "string") visit(plugins);
  const build = valueOf(preload, "build");
  if (build === "absent") return [...problems, at(preload.parent, MISSING)];
  if (build === "hidden" || !ts.isObjectLiteralExpression(build)) return [...problems, at(preload.parent, unseen("build in the preload section"))];
  const setting = valueOf(build, "externalizeDeps");
  if (setting === "hidden") return [...problems, at(build.parent, unseen("build.externalizeDeps in the preload section"))];
  return setting !== "absent" && setting.kind === ts.SyntaxKind.FalseKeyword ? problems : [...problems, at(preload.parent, MISSING)];
}

/** The `preload-bundle` rule on the electron.vite.config.ts of every electron-vite workspace; a missing file has no finding. */
export function auditPreloadBundles(root: string): Finding[] {
  return resolveHarness(root)
    .workspaces.filter((workspace) => workspace.shape === "electron-vite")
    .flatMap((workspace): Finding[] => {
      const file = posix.join(workspace.path, CONFIG);
      if (!fs.existsSync(join(root, file))) return [];
      return preloadBundleProblems(fs.readFileSync(join(root, file), "utf8")).map((problem) => ({ rule: "preload-bundle", file, ...problem }));
    });
}
