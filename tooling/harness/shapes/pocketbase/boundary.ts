import { posix } from "node:path";
import type ts from "typescript";
import type { SourceFinding } from "../shape.ts";
import { POCKETBASE_LAYOUT as LAYOUT } from "./source-rules.ts";

type Compiler = typeof ts;

const appMessage = (workspace: string): string =>
  `Import only ${workspace}/shared/ from the app: hooks, migrations and declarations run inside PocketBase, not in the app ${LAYOUT}.`;
const workspaceMessage = (workspace: string): string =>
  `Keep ${workspace}/ to its own files: PocketBase loads only what is in this folder, and the app's code is not there ${LAYOUT}.`;

function isRequireOrImport(ts: Compiler, node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require");
}

/** The module specifier a node names: an import or export, an import assignment, require(), import(), or an import() type. */
function specifierOf(ts: Compiler, node: ts.Node): string | undefined {
  let specifier: ts.Node | undefined;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
  else if (ts.isExternalModuleReference(node)) specifier = node.expression;
  else if (ts.isCallExpression(node) && isRequireOrImport(ts, node)) specifier = node.arguments[0];
  else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
  return specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier.text : undefined;
}

function within(folder: string, path: string): boolean {
  if (folder === "") return path !== ".." && !path.startsWith("../");
  return path === folder || path.startsWith(`${folder}/`);
}

/** The message for an import from a file in `home` (undefined outside every workspace) to the repository path `target`. */
function crossing(home: string | undefined, workspaces: readonly string[], target: string): string | undefined {
  if (home !== undefined) return within(home, target) ? undefined : workspaceMessage(home);
  const entered = workspaces.find((folder) => within(folder, target) && !within(posix.join(folder, "shared"), target));
  return entered === undefined ? undefined : appMessage(entered);
}

/**
 * The app imports only a pocketbase workspace's shared/, and the workspace imports nothing outside its own folder.
 * `file` is the repository path; a non-relative specifier, a package or an alias, is not judged.
 */
export function pocketbaseBoundary(file: string, source: ts.SourceFile, workspaces: readonly string[], ts: Compiler): SourceFinding[] {
  if (workspaces.length === 0) return [];
  const home = workspaces.filter((folder) => within(folder, file)).sort((a, b) => b.length - a.length)[0];
  const findings: SourceFinding[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(ts, node);
    const message = specifier?.startsWith(".") === true ? crossing(home, workspaces, posix.normalize(posix.join(posix.dirname(file), specifier))) : undefined;
    if (message !== undefined) findings.push({ rule: "pb-boundary", line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
