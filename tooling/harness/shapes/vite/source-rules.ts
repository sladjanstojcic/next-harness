import type ts from "typescript";
import type { SourceFinding } from "../shape.ts";

export const VITE_LAYOUT = "(Vite layout)";
export const ENV_FILE = "src/shared/lib/env.ts";
type Compiler = typeof ts;

const isImportMeta = (ts: Compiler, node: ts.Node): boolean =>
  ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === "meta";

/** `import.meta.env`, `import.meta["env"]`, or `env` taken from `import.meta` by destructuring. */
function readsEnv(ts: Compiler, node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "env" && isImportMeta(ts, node.expression);
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return ts.isStringLiteralLike(key) && key.text === "env" && isImportMeta(ts, node.expression);
  }
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined || !isImportMeta(ts, node.initializer)) return false;
  if (!ts.isObjectBindingPattern(node.name)) return false;
  return node.name.elements.some((element) => {
    const key = element.propertyName ?? element.name;
    return (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === "env";
  });
}

/**
 * The rules only a Vite app has: under src/, `import.meta.env` is read in src/shared/lib/env.ts only, where it is
 * validated once, and "server-only", which belongs to Next, is reported.
 */
export function viteSourceRules(path: string, source: ts.SourceFile, ts: Compiler): SourceFinding[] {
  const findings: SourceFinding[] = [];
  if (!path.startsWith("src/")) return findings;
  const add = (rule: string, node: ts.Node, message: string): void => {
    findings.push({ rule, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: `${message} ${VITE_LAYOUT}` });
  };
  const visit = (node: ts.Node): void => {
    if (path !== ENV_FILE && readsEnv(ts, node)) {
      add("env-access", node, `Read import.meta.env in ${ENV_FILE} only, where it is validated once; import its typed env value here`);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "server-only") {
      add("server-only", node, 'Remove "server-only": it is a Next.js package and this app has no server');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
