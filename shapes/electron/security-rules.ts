import type ts from "typescript";
import { TEST_FILE } from "../next-modules.ts";

type Compiler = typeof ts;
type Report = (rule: string, node: ts.Node, message: string) => void;

/** The webPreferences values that open the window to the page it shows. */
const INSECURE: ReadonlyMap<string, boolean> = new Map([
  ["nodeIntegration", true],
  ["contextIsolation", false],
  ["sandbox", false],
  ["webSecurity", false],
  ["webviewTag", true],
  ["enableRemoteModule", true],
]);
const SAFE = "contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity on, and webviewTag and enableRemoteModule off";
const REMOTE = /^@electron\/remote(?:\/|$)/;
/** The one file that may open an address it did not write: it checks the address first. */
const OPENER = /^src\/main\/[^/]+\/open-external\.ts$/;
const OPENER_ADVICE =
  "Call it from a file named open-external.ts in a src/main/ area folder (src/main/links/open-external.ts), which checks the protocol before it opens the address; a plain string literal passes anywhere";

/** `ipcMain` in `ipcMain.handle(…)`, and `shell` in `electron.shell.openExternal(…)`. */
export function ownerOf(ts: Compiler, node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
}

/** A property's name as written: `sandbox`, `"sandbox"`, `x.sandbox` or `x["sandbox"]`. */
function keyOf(ts: Compiler, node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
}

/**
 * `sandbox: false` in an object literal, and `x.sandbox = false` or `x["sandbox"] = false`. A shorthand `{ sandbox }`
 * and a value that is not a literal are not followed.
 */
function insecureOption(ts: Compiler, node: ts.Node): string | undefined {
  const assigned = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && !ts.isIdentifier(node.left);
  const [key, value] = ts.isPropertyAssignment(node) ? [node.name, node.initializer] : assigned ? [node.left, node.right] : [];
  const name = key === undefined ? undefined : keyOf(ts, key);
  const wanted = name === undefined ? undefined : INSECURE.get(name);
  if (name === undefined || wanted === undefined || value === undefined) return undefined;
  return value.kind === (wanted ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword) ? `${name}: ${String(wanted)}` : undefined;
}

/** The module a declaration or a dynamic `import()` loads, when it is written as a string. */
function importedModule(ts: Compiler, node: ts.Node): string | undefined {
  const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : dynamic ? node.arguments[0] : undefined;
  return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : undefined;
}

/** The local names of `const { openExternal } = shell` and `const { openExternal: open } = shell`. */
function destructuredOpeners(ts: Compiler, source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined && ownerOf(ts, node.initializer) === "shell") {
      for (const element of node.name.elements) {
        const property = element.propertyName ?? element.name;
        if (ts.isIdentifier(property) && property.text === "openExternal" && ts.isIdentifier(element.name)) names.add(element.name.text);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  return names;
}

/** The address of `shell.openExternal(address)`, or of a call under a name destructured from `shell`. */
function openedAddress(ts: Compiler, node: ts.Node, openers: ReadonlySet<string>): ts.Expression | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const direct = ts.isPropertyAccessExpression(callee) && callee.name.text === "openExternal" && ownerOf(ts, callee.expression) === "shell";
  return direct || (ts.isIdentifier(callee) && openers.has(callee.text)) ? node.arguments[0] : undefined;
}

/**
 * The `electron-security` rule. In src/main/ and src/shared/, a window option that hands the page Node, drops its
 * isolation or switches on `<webview>` or the remote module; in src/renderer/, a `<webview>` element; in src/,
 * `shell.openExternal` with an address the call did not write, outside the one file that checks it (all three tests
 * aside); and in every file, an import of `@electron/remote`. An alias of the function (`const open = shell.openExternal`),
 * `shell` under another name and a destructuring from `electron` itself are not followed, and a constant as the address
 * is reported though it may hold a literal.
 */
export function electronSecurityRules(path: string, source: ts.SourceFile, ts: Compiler, report: Report): void {
  const tested = TEST_FILE.test(path);
  const options = /^src\/(?:main|shared)\//.test(path) && !tested;
  const renderer = path.startsWith("src/renderer/") && !tested;
  const opens = path.startsWith("src/") && !tested && !OPENER.test(path);
  const openers = opens ? destructuredOpeners(ts, source) : new Set<string>();
  const visit = (node: ts.Node): void => {
    const insecure = options ? insecureOption(ts, node) : undefined;
    if (insecure !== undefined) {
      report("electron-security", node, `${insecure} opens the window to the page it shows. Keep ${SAFE}; the renderer reaches Node through src/preload/`);
    }
    if (renderer && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === "webview") {
      const instead = "open outside content in the system browser, or in a WebContentsView that src/main/ creates with the safe settings";
      report("electron-security", node, `A <webview> element embeds a page with settings of its own, which that page's host can loosen; ${instead}`);
    }
    if (REMOTE.test(importedModule(ts, node) ?? "")) {
      const instead = "expose the one call the window needs through src/preload/ and answer it in src/main/";
      report("electron-security", node, `@electron/remote hands the window the main process's own objects, which undoes the sandbox; ${instead}`);
    }
    const address = opens ? openedAddress(ts, node, openers) : undefined;
    if (address !== undefined && !ts.isStringLiteral(address) && !ts.isNoSubstitutionTemplateLiteral(address)) {
      const why = "shell.openExternal starts whichever program handles the address, so an address the page can influence must be checked first";
      report("electron-security", node, `${why}. ${OPENER_ADVICE}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
