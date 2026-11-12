import type ts from "typescript";
import type { SourceFinding } from "../shape.ts";
import { electronSecurityRules, ownerOf } from "./security-rules.ts";

export const ELECTRON_LAYOUT = "(Electron layout)";
type Compiler = typeof ts;

const BRIDGE: readonly string[] = ["ipcRenderer", "contextBridge"];
/** The calls whose first argument is a channel name; `webContents.send` is main's way to the renderer. */
const CHANNEL_CALLS: ReadonlyMap<string, readonly string[]> = new Map([
  ["ipcMain", ["handle", "handleOnce", "on", "once"]],
  ["ipcRenderer", ["invoke", "send", "sendSync", "on", "once"]],
  ["webContents", ["send"]],
]);

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
 * The rules only an Electron project has: `electron-security` (see security-rules.ts); outside src/preload/, the bridge
 * objects (once per file); anywhere in src/, a channel written in the call or in a constant of the same file; and
 * "server-only", which belongs to Next.
 */
export function electronSourceRules(path: string, source: ts.SourceFile, ts: Compiler): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const add = (rule: string, node: ts.Node, message: string): void => {
    findings.push({ rule, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: `${message} ${ELECTRON_LAYOUT}` });
  };
  const inSource = path.startsWith("src/");
  let bridgeSeen = !inSource || path.startsWith("src/preload/");
  /** The names this file gives a channel text to, so `const CHANNEL = "a:b"` does not pass where `"a:b"` would not. */
  const local = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isText(ts, node.initializer))
      local.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  if (inSource) collect(source);
  electronSecurityRules(path, source, ts, add);
  const visit = (node: ts.Node): void => {
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
