import type ts from "typescript";
import { readsImportMetaEnv, type SourceFinding } from "../shape.ts";

export const VITE_LAYOUT = "(Vite layout)";
export const ENV_FILE = "src/shared/lib/env.ts";
type Compiler = typeof ts;

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
    if (path !== ENV_FILE && readsImportMetaEnv(ts, node)) {
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
