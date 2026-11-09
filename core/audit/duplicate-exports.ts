import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_FILE } from "../../shapes/next-modules.ts";
import { ts } from "../../tools/typescript.ts";
import { isVendoredIn, resolveHarness } from "../path-check.ts";
import { listFiles } from "./list-files.ts";
import type { Finding } from "./finding.ts";

// Ported from next-harness rules-duplicates (0.2.2), with the template's Finding interface.
const MIN_NODES = 40;
const fixtureModule = /(^|\/)test-data(\.tsx?$|\/)/;
interface Exported {
  file: string;
  name: string;
  line: number;
  shape: string;
}

function boundNames(declaration: ts.Node): Set<string> {
  const names = new Set<string>();
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) bind(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  return names;
}

// Normalize bound names only: imported names, property names and literal values remain part of the shape.
function shapeOf(declaration: ts.Node): { shape: string; nodes: number } {
  const bound = boundNames(declaration);
  const numbered = new Map<string, number>();
  const parts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (bound.has(node.text)) {
        if (!numbered.has(node.text)) numbered.set(node.text, numbered.size);
        parts.push(`$${String(numbered.get(node.text))}`);
      } else parts.push(node.text);
    } else if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) parts.push(JSON.stringify(node.text));
    else parts.push(String(node.kind));
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  return { shape: parts.join(" "), nodes: parts.length };
}

function exportsOf(file: string, source: ts.SourceFile): Exported[] {
  const found: Exported[] = [];
  const take = (name: string, body: ts.Node, node: ts.Node): void => {
    const { shape, nodes } = shapeOf(body);
    if (nodes >= MIN_NODES) found.push({ file, name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, shape });
  };
  for (const statement of source.statements) {
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined) take(statement.name.text, statement, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer !== undefined && ts.isIdentifier(declaration.name) && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          take(declaration.name.text, initializer, declaration);
        }
      }
    }
  }
  return found;
}

export function findDuplicateExports(root: string, files: string[]): Finding[] {
  const selected = new Set(files);
  const harness = resolveHarness(root);
  const byShape = new Map<string, Exported[]>();
  for (const file of listFiles(root)) {
    if (!/\.tsx?$/.test(file) || isVendoredIn(harness, file) || TEST_FILE.test(file) || fixtureModule.test(file)) continue;
    const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    for (const exported of exportsOf(file, source)) byShape.set(exported.shape, [...(byShape.get(exported.shape) ?? []), exported]);
  }
  const findings: Finding[] = [];
  for (const copies of byShape.values()) {
    for (const copy of copies) {
      if (!selected.has(copy.file)) continue;
      const original = copies.find((other) => other !== copy);
      if (!original) continue;
      findings.push({
        rule: "duplicate-export",
        file: copy.file,
        line: copy.line,
        message: `${copy.name} is ${original.file}#${original.name} under another name. Reuse that export; put cross-module logic in src/shared/lib/ or src/shared/components/.`,
      });
    }
  }
  return findings;
}
