import type ts from "typescript";
import type { SourceFinding } from "../shape.ts";

export const POCKETBASE_LAYOUT = "(PocketBase layout)";
type Compiler = typeof ts;

const ENTRY_FILE = /^pb_hooks\/[^/]+\.pb\.ts$/;
const SHARED_FILE = /^shared\//;
const GLOBALS: ReadonlySet<string> = new Set([
  "$app",
  "$apis",
  "$http",
  "$os",
  "$security",
  "$filesystem",
  "$mails",
  "$dbx",
  "$tokens",
  "$filepath",
  "$template",
  "__hooks",
]);

const ENTRY_MODULE = `PocketBase loads an entry as a script, not a module: move this into pb_hooks/<area>/ and require it inside the handler; take types through import("...") expressions or ambient declarations in types/ ${POCKETBASE_LAYOUT}.`;
const REQUIRE_SCOPE = `Call require() inside the handler: PocketBase runs each handler in its own VM, where a value from the file's top level does not exist ${POCKETBASE_LAYOUT}.`;
const SHARED_PURE = `Keep shared/ to plain values and types: the PocketBase VM and the app both load this file, so it may not use require, a package, Node or a PocketBase global ${POCKETBASE_LAYOUT}.`;

function isModuleSyntax(ts: Compiler, statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement)) return true;
  if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) return true;
  if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) return true;
  return ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) === true;
}

function isRequire(ts: Compiler, node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require";
}

/** The specifier a node loads at run time: an import or re-export, a dynamic import() call, or an import assignment. */
function runtimeSpecifier(ts: Compiler, node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0];
  return ts.isExternalModuleReference(node) ? node.expression : undefined;
}

/** A PocketBase global read as a value, not a property name, a renamed key or the name a declaration gives; the caller skips types. */
function isGlobalValue(ts: Compiler, node: ts.Node): boolean {
  if (!ts.isIdentifier(node) || !GLOBALS.has(node.text)) return false;
  const { parent } = node;
  const renamedKey = (ts.isBindingElement(parent) || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.propertyName === node;
  if (renamedKey) return false;
  return ts.isShorthandPropertyAssignment(parent) || !("name" in parent && parent.name === node);
}

/**
 * The rules a PocketBase backend has: an entry in pb_hooks/ is a script, with no module syntax at its top and require()
 * only inside a function body; shared/ is loaded by both the VM and the app, so it holds plain values and types.
 */
export function pocketbaseSourceRules(path: string, source: ts.SourceFile, ts: Compiler): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const add = (rule: string, node: ts.Node, message: string): void => {
    findings.push({ rule, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message });
  };
  if (ENTRY_FILE.test(path)) {
    for (const statement of source.statements) if (isModuleSyntax(ts, statement)) add("pb-entry-module", statement, ENTRY_MODULE);
    const visit = (node: ts.Node, inBody: boolean): void => {
      if (!inBody && isRequire(ts, node)) add("pb-require-scope", node, REQUIRE_SCOPE);
      const body = ts.isFunctionLike(node) && "body" in node ? node.body : undefined;
      ts.forEachChild(node, (child) => visit(child, inBody || child === body));
    };
    visit(source, false);
  }
  if (SHARED_FILE.test(path)) {
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) return;
      const specifier = runtimeSpecifier(ts, node);
      const external = specifier !== undefined && ts.isStringLiteralLike(specifier) && !specifier.text.startsWith(".");
      if (external || isRequire(ts, node) || isGlobalValue(ts, node)) add("pb-shared-pure", node, SHARED_PURE);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}
