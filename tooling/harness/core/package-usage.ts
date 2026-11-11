import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ts } from "../tools/typescript.ts";
import { listFiles } from "./audit/list-files.ts";

/** Every name of an entry file counts as used: a namespace import, `export *` or a dynamic import. */
export const ALL_NAMES = "*";

const manifest = z.object({ name: z.string(), exports: z.unknown().optional() });

/** The source files an `exports` value points at: a string, or the string leaves of its conditions. */
function targets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(targets) : [];
}

/** The package-relative file an import specifier of the package resolves to through its `exports`; a `*` key matches one segment run. */
function entryFile(exported: readonly [string, string][], subpath: string): string | undefined {
  for (const [key, target] of exported) {
    if (key === subpath) return path.posix.normalize(target);
    const [before, after] = key.split("*");
    if (before === undefined || after === undefined || !subpath.startsWith(before) || !subpath.endsWith(after)) continue;
    return path.posix.normalize(target.replace("*", subpath.slice(before.length, subpath.length - after.length)));
  }
  return undefined;
}

/** The names one file takes from a module specifier, by statement; a call form takes them all. */
function importedNames(source: ts.SourceFile, record: (specifier: string, name: string) => void): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.name !== undefined) record(node.moduleSpecifier.text, "default");
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) record(node.moduleSpecifier.text, ALL_NAMES);
      if (bindings !== undefined && ts.isNamedImports(bindings))
        for (const element of bindings.elements) record(node.moduleSpecifier.text, (element.propertyName ?? element.name).text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      if (clause === undefined || !ts.isNamedExports(clause)) record(node.moduleSpecifier.text, ALL_NAMES);
      else for (const element of clause.elements) record(node.moduleSpecifier.text, (element.propertyName ?? element.name).text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [argument] = node.arguments;
      const loads = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require");
      if (loads && argument !== undefined && ts.isStringLiteral(argument)) record(argument.text, ALL_NAMES);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * What the rest of the repository imports from a package's public entries: entry file, relative to the package, to the
 * names taken from it. Knip runs inside the package and cannot see those imports, so the gate reads them here to tell an
 * export another workspace uses from one nobody uses.
 */
export function importedFromPackage(root: string, workspacePath: string): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const file = path.join(root, workspacePath, "package.json");
  const parsed = fs.existsSync(file) ? manifest.safeParse(JSON.parse(fs.readFileSync(file, "utf8"))) : undefined;
  if (parsed?.success !== true) return used;
  const { name, exports } = parsed.data;
  const exported = (typeof exports === "object" && exports !== null ? Object.entries(exports) : [[".", exports] as const]).flatMap(([key, value]) =>
    targets(value).map((target): [string, string] => [key, target]),
  );
  const outside = listFiles(root).filter((candidate) => /\.[cm]?tsx?$/.test(candidate) && !candidate.startsWith(`${workspacePath}/`));
  for (const candidate of outside) {
    const text = fs.readFileSync(path.join(root, candidate), "utf8");
    if (!text.includes(name)) continue;
    importedNames(ts.createSourceFile(candidate, text, ts.ScriptTarget.Latest, false), (specifier, imported) => {
      if (specifier !== name && !specifier.startsWith(`${name}/`)) return;
      const entry = entryFile(exported, `.${specifier.slice(name.length)}`);
      if (entry !== undefined) used.set(entry, (used.get(entry) ?? new Set()).add(imported));
    });
  }
  return used;
}
