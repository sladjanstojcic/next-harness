import type ts from "typescript";
import type { SourceFinding } from "../shape.ts";

export const NODE_LAYOUT = "(Node layout)";
export const ENV_FILE = "src/shared/lib/env.ts";
/** app.ts mounts and configures; a routes.ts parses, calls its module and answers. Logic past this belongs in the module. */
export const MAX_ROUTE_LINES = 80;
const ROUTE_FILE = /^src\/(?:app\/app|modules\/[^/]+\/routes)\.ts$/;
type Compiler = typeof ts;

const isImportMeta = (ts: Compiler, node: ts.Node): boolean =>
  ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === "meta";

/** The specifier of an import, a re-export, a dynamic import() or require(), when it is a string literal. */
function specifierOf(ts: Compiler, node: ts.Node): ts.Node | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier;
  }
  const call =
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"));
  return call && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0] : undefined;
}

/** Node runs the source as written: it resolves no extensionless path and applies no tsconfig `paths`. */
function importAdvice(specifier: string): string | undefined {
  if (specifier.startsWith("@/")) {
    return `Import with #/ instead of @/: Node applies no tsconfig paths, and package.json "imports" maps "#/*" to "./src/*"`;
  }
  const local = specifier.startsWith(".") || specifier.startsWith("#/");
  if (!local || /\.(?:ts|json)$/.test(specifier)) return undefined;
  return `Name the file with its .ts extension (${specifier.replace(/\.[cm]?js$/, "")}.ts): Node runs the TypeScript source and resolves the path exactly as written`;
}

/**
 * The rules only a Node service has, under src/: relative and #/ imports name their .ts file, app.ts and each routes.ts
 * stay thin, and `import.meta.env` and "server-only", which belong to bundlers and to Next, are reported.
 */
export function nodeSourceRules(path: string, source: ts.SourceFile, ts: Compiler): SourceFinding[] {
  const findings: SourceFinding[] = [];
  if (!path.startsWith("src/")) return findings;
  const add = (rule: string, line: number, message: string): void => {
    findings.push({ rule, line, message: `${message} ${NODE_LAYOUT}` });
  };
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const count = source.text.split(/\r\n|\r|\n/).length - (/(?:\r\n|\r|\n)$/.test(source.text) ? 1 : 0);
  if (ROUTE_FILE.test(path) && count > MAX_ROUTE_LINES) {
    add(
      "thin-route",
      1,
      `${path} has ${String(count)} lines (maximum ${String(MAX_ROUTE_LINES)}); move the logic into the module's domain/ or data/ and call it here`,
    );
  }
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "env" && isImportMeta(ts, node.expression)) {
      add("env-access", lineOf(node), `import.meta.env belongs to bundlers; read process.env in ${ENV_FILE} only, where it is validated once`);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "server-only") {
      add("server-only", lineOf(node), 'Remove "server-only": it is a Next.js package, and a service has no client bundle');
    }
    const specifier = specifierOf(ts, node);
    const advice = specifier !== undefined && ts.isStringLiteral(specifier) ? importAdvice(specifier.text) : undefined;
    if (specifier !== undefined && advice !== undefined) add("node-import", lineOf(specifier), advice);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
