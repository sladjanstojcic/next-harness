import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { workspaceOf } from "../../config.ts";
import { TEST_FILE } from "../../shapes/next-modules.ts";
import type { ContentMessage, ContentProfile } from "../../shapes/shape.ts";
import { ts } from "../../tools/typescript.ts";
import { isVendoredIn, resolveHarness, type Harness } from "../path-check.ts";
import type { Finding } from "./finding.ts";
import { inlineDisableFindings } from "./inline-disable.ts";

export interface ContentTarget {
  file: string;
  path: string;
  profile?: ContentProfile;
  pageLines?: number;
}

function message(profile: ContentProfile, key: ContentMessage, values: Record<string, string> = {}): string {
  return profile.messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

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

/** The longest matching alias prefix wins, so "~/config/" beats "~/" whatever the profile's key order. */
export function resolveTarget(profile: ContentProfile, file: string, target: string): string {
  const alias = Object.entries(profile.aliases)
    .filter(([prefix]) => target.startsWith(prefix))
    .sort(([a], [b]) => b.length - a.length)[0];
  if (alias !== undefined) return posix.normalize(`${alias[1]}${target.slice(alias[0].length)}`);
  if (target.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), target));
  return target;
}

/** An import erased at compile time: `import type`, or named imports that are all `type`. */
function isTypeOnlyImport(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node) || node.importClause === undefined) return false;
  const clause = node.importClause;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return (
    clause.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function calleeRoot(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) return calleeRoot(node.expression);
  return undefined;
}

function auditDirectives({ file, path, profile }: ContentTarget, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  if (profile === undefined) return findings;
  const directives: { node: ts.Node; text: string }[] = [];
  const imports: { node: ts.Node; target: string; relative: boolean }[] = [];
  let hasServerOnly = false;
  let hasBuilder = false;
  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) directives.push({ node, text: node.expression.text });
    const target = importTarget(node);
    if (target !== undefined) imports.push({ node, target: resolveTarget(profile, path, target), relative: target.startsWith(".") });
    if (ts.isImportDeclaration(node) && target === "server-only" && !node.importClause?.isTypeOnly) hasServerOnly = true;
    if (ts.isCallExpression(node) && profile.actionBuilders.includes(calleeRoot(node.expression) ?? "")) hasBuilder = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const add = (rule: string, key: ContentMessage, node?: ts.Node): void => {
    findings.push({ file, rule, line: node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : 1, message: message(profile, key) });
  };
  if (profile.serverFile?.test(path) && !TEST_FILE.test(path) && !hasServerOnly) add("server-only", "serverOnly");
  const serverDirectives = directives.filter(({ text }) => text === "use server");
  if (profile.actionFile) {
    const isAction = profile.actionFile.test(path);
    const invalidServer = serverDirectives.find(({ node }) => !isAction || node !== source.statements[0]);
    if (invalidServer || (isAction && (!serverDirectives.some(({ node }) => node === source.statements[0]) || !hasBuilder))) {
      add("use-server-placement", "useServer", invalidServer?.node ?? serverDirectives[0]?.node);
    }
  }
  const clientDirectives = directives.filter(({ text }) => text === "use client");
  for (const directive of clientDirectives) {
    if (profile.clientFile && !profile.clientFile.test(path)) add("use-client-placement", "useClient", directive.node);
  }
  const { sourceRoot } = profile;
  for (const { node, target, relative } of imports) {
    const isServer = /(?:^|\/)server(?:\.(?:js|ts)x?$|\/|$)/.test(target);
    const leavesSource = relative && sourceRoot !== undefined && path.startsWith(sourceRoot) && !target.startsWith(sourceRoot);
    if (clientDirectives.length > 0 && isServer && !isTypeOnlyImport(node) && profile.actionImport?.test(target) !== true)
      add("client-imports-server", "clientImportsServer", node);
    if (profile.publicIndex?.test(path) && (isServer || profile.actionImport?.test(target))) add("index-exports", "indexExports", node);
    if (profile.packageBoundary !== undefined && (target === ".." || target.startsWith("../") || leavesSource)) {
      findings.push({
        file,
        rule: "package-boundary",
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message: profile.packageBoundary,
      });
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

/** `process.env.NEXT_PUBLIC_*` read directly, which Next inlines at build time, in a profile that allows it. */
function isPublicRead(profile: ContentProfile, env: ts.Node): boolean {
  return profile.publicEnvAllowed === true && property(env.parent)?.name.startsWith("NEXT_PUBLIC_") === true;
}

/** Content findings for one file against the given target's profile; auditContent resolves the target from the workspace. */
export function auditSource(root: string, target: ContentTarget, text: string): Finding[] {
  const source = ts.createSourceFile(target.file, text, ts.ScriptTarget.Latest, true);
  const { file, path, profile } = target;
  const findings = auditDirectives(target, source);
  if (profile?.inlineDisable !== undefined) findings.push(...inlineDisableFindings(file, source, profile.inlineDisable));
  const add = (rule: string, message: string, node?: ts.Node): void => {
    findings.push({ rule, file, line: node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : 1, message });
  };
  const count = source.text.split(/\r\n|\r|\n/).length - (/(?:\r\n|\r|\n)$/.test(source.text) ? 1 : 0);
  if (profile && target.pageLines !== undefined && /(?:^|\/)page\.tsx$/.test(path) && count > target.pageLines) {
    add("thin-page", message(profile, "thinPage", { count: String(count), max: String(target.pageLines) }));
  }
  if (profile?.domainFile?.test(path) && !TEST_FILE.test(path)) {
    const test = file.replace(/\.ts$/, ".test.ts");
    if (!existsSync(join(root, test))) add("domain-test", message(profile, "domainTest", { test }));
  }
  const checkEnvironment = profile?.envScope?.test(path) === true && path !== profile.envFile && profile.envAllowed?.test(path) !== true;
  const checkErrors = !TEST_FILE.test(path) && profile?.errorScope?.test(path) === true;
  const checkDeterminism = TEST_FILE.test(file) && !seedMarkers.some((marker) => source.text.includes(marker));
  const visit = (node: ts.Node): void => {
    const access = property(node);
    if (profile && checkEnvironment && access?.name === "env" && isName(access.object, "process") && !isPublicRead(profile, node)) {
      add("env-access", message(profile, "envAccess"), node);
    }
    const errorString = ts.isCallExpression(node) && isName(node.expression, "String") && node.arguments.some(rawError);
    if (profile && checkErrors && ((access && rawError(access.object) && ["message", "stack"].includes(access.name)) || errorString)) {
      add("error-text", message(profile, "errorText"), node);
    }
    const leak = checkDeterminism ? nondeterminism(node) : undefined;
    if (leak)
      add("test-determinism", `${leak} needs a seed, frozen clock or mock in this colocated test file; keep test setup beside the code it covers.`, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function targetOf(harness: Harness, file: string): ContentTarget {
  const found = workspaceOf(harness.workspaces, file);
  if (found === undefined) return { file, path: file };
  const shape = found.entry.shapeImpl;
  return { file, path: found.path, profile: shape.content, pageLines: shape.limits.pageLines };
}

export function auditContent(root: string, files: string[]): Finding[] {
  const harness = resolveHarness(root);
  return files
    .filter((file) => /\.tsx?$/.test(file) && !isVendoredIn(harness, file))
    .flatMap((file) => auditSource(root, targetOf(harness, file), readFileSync(join(root, file), "utf8")));
}
