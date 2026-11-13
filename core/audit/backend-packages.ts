import { TEST_FILE } from "../../shapes/next-modules.ts";
import { ts } from "../../tools/typescript.ts";
import { importTarget, isTypeOnlyImport, type ContentTarget } from "./content-rules.ts";
import type { Finding } from "./finding.ts";

/** Packages that open a connection to a backend; a scope ends in "/". The config's backendPackages adds to them. */
export const BACKEND_PACKAGES: readonly string[] = [
  "@supabase/",
  "pocketbase",
  "appwrite",
  "node-appwrite",
  "convex",
  "@prisma/",
  "drizzle-orm",
  "pg",
  "postgres",
  "mysql2",
  "mongodb",
  "mongoose",
  "better-sqlite3",
  "@libsql/client",
  "@neondatabase/serverless",
  "redis",
  "ioredis",
  "@upstash/",
];

export function isBackendPackage(specifier: string, packages: readonly string[]): boolean {
  return packages.some((entry) => (entry.endsWith("/") ? specifier.startsWith(entry) : specifier === entry || specifier.startsWith(`${entry}/`)));
}

/** A type holds no connection, so `import type` and `export type ... from` pass wherever they sit. */
function isTypeOnly(node: ts.Node): boolean {
  return isTypeOnlyImport(node) || (ts.isExportDeclaration(node) && node.isTypeOnly);
}

/** Imports of a backend package outside the shape's backend folder; tests may build their own client. */
export function backendPackageFindings({ file, path, profile }: ContentTarget, source: ts.SourceFile, packages: readonly string[]): Finding[] {
  const backend = profile?.backend;
  if (backend === undefined || !backend.scope.test(path) || backend.allowed.test(path) || TEST_FILE.test(path)) return [];
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const target = importTarget(node);
    if (target !== undefined && isBackendPackage(target, packages) && !isTypeOnly(node)) {
      findings.push({ file, rule: "backend-package", line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: backend.message });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
