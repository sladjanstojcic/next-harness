import type ts from "typescript";
import { TEST_FILE } from "../next-modules.ts";
import type { SourceFinding } from "../shape.ts";

export const ELECTRON_LAYOUT = "(Electron layout)";
type Compiler = typeof ts;

/** The webPreferences values that open the window to the page it shows. */
const INSECURE: ReadonlyMap<string, boolean> = new Map([
  ["nodeIntegration", true],
  ["contextIsolation", false],
  ["sandbox", false],
  ["webSecurity", false],
]);
const BRIDGE: readonly string[] = ["ipcRenderer", "contextBridge"];
/** The calls whose first argument is a channel name; `webContents.send` is main's way to the renderer. */
const CHANNEL_CALLS: ReadonlyMap<string, readonly string[]> = new Map([
  ["ipcMain", ["handle", "handleOnce", "on", "once"]],
  ["ipcRenderer", ["invoke", "send", "sendSync", "on", "once"]],
  ["webContents", ["send"]],
]);

/** `ipcMain` in `ipcMain.handle(…)`, and `ipcRenderer` in `window.electron.ipcRenderer.send(…)`. */
function ownerOf(ts: Compiler, node: ts.Expression): string | undefined {
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

/** A channel written here rather than taken from the contract: a string, a template, or a concatenation. */
function isText(ts: Compiler, node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return true;
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

function channelArgument(ts: Compiler, node: ts.Node): ts.Expression | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const methods = CHANNEL_CALLS.get(ownerOf(ts, node.expression.expression) ?? "");
  return methods?.includes(node.expression.name.text) === true ? node.arguments[0] : undefined;
}

/**
 * The rules only an Electron project has. In src/main/ and src/shared/, a window option that hands the page Node or drops
 * its isolation (tests aside); outside src/preload/, the bridge objects (once per file); anywhere in src/, a channel
 * written in the call or in a constant of the same file; and "server-only", which belongs to Next.
 */
export function electronSourceRules(path: string, source: ts.SourceFile, ts: Compiler): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const add = (rule: string, node: ts.Node, message: string): void => {
    findings.push({ rule, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: `${message} ${ELECTRON_LAYOUT}` });
  };
  const inSource = path.startsWith("src/");
  const options = /^src\/(?:main|shared)\//.test(path) && !TEST_FILE.test(path);
  let bridgeSeen = !inSource || path.startsWith("src/preload/");
  /** The names this file gives a channel text to, so `const CHANNEL = "a:b"` does not pass where `"a:b"` would not. */
  const local = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isText(ts, node.initializer))
      local.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  if (inSource) collect(source);
  const visit = (node: ts.Node): void => {
    const insecure = options ? insecureOption(ts, node) : undefined;
    if (insecure !== undefined) {
      const safe = "contextIsolation: true, sandbox: true, nodeIntegration: false and webSecurity on";
      add("electron-security", node, `${insecure} opens the window to the page it shows. Keep ${safe}; the renderer reaches Node through src/preload/`);
    }
    if (!bridgeSeen && ts.isIdentifier(node) && BRIDGE.includes(node.text)) {
      bridgeSeen = true;
      const where = "Use ipcRenderer and contextBridge only in src/preload/, which exposes a typed API with contextBridge.exposeInMainWorld";
      add("electron-bridge", node, `${where}; the renderer calls that API on window, and src/main/ answers with ipcMain`);
    }
    const channel = inSource ? channelArgument(ts, node) : undefined;
    if (channel !== undefined && (isText(ts, channel) || (ts.isIdentifier(channel) && local.has(channel.text)))) {
      const where = "Name the channel once in src/shared/, as an exported constant, and pass that constant here";
      add("ipc-channel", channel, `${where}, so main, preload and renderer agree on one name`);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "server-only") {
      add("server-only", node, 'Remove "server-only": it is a Next.js package and nothing here runs on a server; Node code belongs in src/main/');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
