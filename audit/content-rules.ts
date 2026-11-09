import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { isVendored, MAX_PAGE_LINES, TEST_FILE } from "../structure.ts";
import type { Finding } from "./finding.ts";

const actionFile = /^src\/modules\/[^/]+\/actions\/[^/]+-action\.ts$/;
const serverFile = /^src\/modules\/[^/]+\/server(?:\.ts$|\/)/;
const clientFile = /^(?:src\/modules\/[^/]+\/components\/|src\/shared\/(?:components|ui|hooks)\/|src\/app\/(?:.*\/)?error\.tsx$|src\/app\/global-error\.tsx$)/;

function importTarget(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
  ) {
    const argument = node.arguments[0];
    if (argument && ts.isStringLiteral(argument)) return argument.text;
  }
  return undefined;
}

function resolveTarget(file: string, target: string): string {
  if (target.startsWith("@/")) return posix.normalize(`src/${target.slice(2)}`);
  if (target.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), target));
  return target;
}

function auditDirectives(file: string, source: ts.SourceFile): Finding[] {
  const directives: { node: ts.Node; text: string }[] = [];
  const imports: { node: ts.Node; target: string }[] = [];
  let hasServerOnly = false;
  let hasDefineAction = false;
  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) directives.push({ node, text: node.expression.text });
    const target = importTarget(node);
    if (target !== undefined) imports.push({ node, target: resolveTarget(file, target) });
    if (ts.isImportDeclaration(node) && target === "server-only" && !node.importClause?.isTypeOnly) hasServerOnly = true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineAction") hasDefineAction = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const findings: Finding[] = [];
  const add = (rule: string, message: string, node?: ts.Node): void => {
    findings.push({ file, rule, line: node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : 1, message });
  };
  if (serverFile.test(file) && !TEST_FILE.test(file) && !hasServerOnly) {
    add("server-only", 'Import "server-only" in module server.ts and server/ files; client-safe code belongs in components/ or index.ts.');
  }
  const serverDirectives = directives.filter(({ text }) => text === "use server");
  const isAction = actionFile.test(file);
  const invalidServer = serverDirectives.find(({ node }) => !isAction || node !== source.statements[0]);
  if (invalidServer || (isAction && (!serverDirectives.some(({ node }) => node === source.statements[0]) || !hasDefineAction))) {
    add(
      "use-server-placement",
      'Put "use server" first in src/modules/<module>/actions/<name>-action.ts and call defineAction from src/shared/lib/define-action.ts.',
      invalidServer?.node ?? serverDirectives[0]?.node,
    );
  }
  const clientDirectives = directives.filter(({ text }) => text === "use client");
  for (const directive of clientDirectives) {
    if (!clientFile.test(file))
      add(
        "use-client-placement",
        'Put "use client" in module components/, shared components/ui/hooks, or src/app error.tsx and global-error.tsx.',
        directive.node,
      );
  }
  for (const { node, target } of imports) {
    const isServer = /(?:^|\/)server(?:\.tsx?$|\/|$)/.test(target);
    if (clientDirectives.length > 0 && isServer) {
      add(
        "client-imports-server",
        "Import client-safe code through a module's index.ts or actions/<name>-action.ts; server.ts and server/ belong on the server.",
        node,
      );
    }
    if (/^src\/modules\/[^/]+\/index\.ts$/.test(file) && (isServer || /^src\/modules\/[^/]+\/actions(?:\/|$)/.test(target))) {
      add("index-exports", "Keep index.ts client-safe: expose queries through server.ts and import mutations directly from actions/<name>-action.ts.", node);
    }
  }
  return findings;
}

const seedMarkers = ["useFakeTimers", "setSystemTime", "mock.timers", "mockImplementation", "seed(", "fc.assert", "fc.property"];

function property(node: ts.Node): { object: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) return { object: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return { object: node.expression, name: node.argumentExpression.text };
  return undefined;
}

function isName(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function nondeterminism(node: ts.Node): string | undefined {
  if (ts.isNewExpression(node) && isName(node.expression, "Date") && (node.arguments?.length ?? 0) === 0) return "new Date()";
  if (!ts.isCallExpression(node)) return undefined;
  if (isName(node.expression, "fetch")) return "fetch()";
  const call = property(node.expression);
  if (call && isName(call.object, "Date") && call.name === "now") return "Date.now()";
  if (call && isName(call.object, "Math") && call.name === "random") return "Math.random()";
  return undefined;
}

function rawError(node: ts.Node): boolean {
  if (!ts.isIdentifier(node)) return false;
  if (["error", "err", "e"].includes(node.text)) return true;
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isCatchClause(parent) && parent.variableDeclaration && isName(parent.variableDeclaration.name, node.text)) return true;
  }
  return false;
}

function inspect(root: string, file: string, source: ts.SourceFile): Finding[] {
  const findings = auditDirectives(file, source);
  const add = (rule: string, message: string, node?: ts.Node): void => {
    findings.push({ rule, file, line: node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : 1, message });
  };
  const count = source.text.split(/\r\n|\r|\n/).length - (/(?:\r\n|\r|\n)$/.test(source.text) ? 1 : 0);
  if (/(?:^|\/)page\.tsx$/.test(file) && count > MAX_PAGE_LINES) {
    add("thin-page", `page.tsx has ${count} lines (maximum ${MAX_PAGE_LINES}); move UI into src/modules/<module>/components/ and import it through index.ts.`);
  }
  if (/^src\/modules\/[^/]+\/domain\/(?:[^/]+\/)?[^/]+\.ts$/.test(file) && !TEST_FILE.test(file)) {
    const test = file.replace(/\.ts$/, ".test.ts");
    if (!existsSync(join(root, test))) add("domain-test", `Put the domain rule's test beside it at ${test}.`);
  }
  const checkEnvironment = file.startsWith("src/") && file !== "src/shared/lib/env.ts";
  const checkErrors = !TEST_FILE.test(file) && (file.startsWith("src/app/") || /(?:^|\/)components\//.test(file));
  const checkDeterminism = TEST_FILE.test(file) && !seedMarkers.some((marker) => source.text.includes(marker));
  const visit = (node: ts.Node): void => {
    const access = property(node);
    if (checkEnvironment && access?.name === "env" && isName(access.object, "process")) {
      add("env-access", "Read and validate environment variables in src/shared/lib/env.ts; import its typed env value here.", node);
    }
    const errorString = ts.isCallExpression(node) && isName(node.expression, "String") && node.arguments.some(rawError);
    if (checkErrors && ((access && rawError(access.object) && ["message", "stack"].includes(access.name)) || errorString)) {
      add(
        "error-text",
        "Use UserError and user-facing error helpers from src/shared/lib/user-error.ts; keep raw error details in src/shared/lib/log.ts.",
        node,
      );
    }
    const leak = checkDeterminism ? nondeterminism(node) : undefined;
    if (leak)
      add("test-determinism", `${leak} needs a seed, frozen clock or mock in this colocated test file; keep test setup beside the code it covers.`, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export function auditContent(root: string, files: string[]): Finding[] {
  return files
    .filter((file) => /\.tsx?$/.test(file) && !isVendored(file))
    .flatMap((file) => {
      const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
      return inspect(root, file, source);
    });
}
