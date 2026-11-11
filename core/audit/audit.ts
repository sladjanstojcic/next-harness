import { existsSync } from "node:fs";
import { join } from "node:path";
import { classify, readLegacy } from "../classes.ts";
import { resolveHarness } from "../path-check.ts";
import { auditContent } from "./content-rules.ts";
import { findDuplicateExports } from "./duplicate-exports.ts";
import type { Finding } from "./finding.ts";
import { listFiles, trackedDependencyFolders } from "./list-files.ts";
import { auditPaths } from "./path-rules.ts";
import { auditTsconfigs } from "./tsconfig-rules.ts";

/** Vendored files are exempt and upstream files are not the harness's to judge; legacy files are audited and reported as pre-existing. */
function present(root: string, files: string[]): string[] {
  const harness = resolveHarness(root);
  const legacy = readLegacy(root, harness.config);
  return files.filter((file) => {
    const pathClass = classify(file, harness, legacy);
    return pathClass !== "vendored" && pathClass !== "upstream" && existsSync(join(root, file));
  });
}

/** Committed dependencies, whatever the path's class: the inventory skips node_modules, so they would hide there. */
function trackedDependencies(root: string): Finding[] {
  return [...trackedDependencyFolders(root)].map(([folder, count]) => ({
    rule: "tracked-node-modules",
    file: folder,
    message: `${String(count)} committed ${count === 1 ? "file" : "files"}; remove them with \`git rm -r --cached ${folder}\` and ignore the folder in .gitignore.`,
  }));
}

/** The whole repository: every rule, including the ones that need the full inventory. Done and CI run this. */
export function audit(root: string): Finding[] {
  const selected = present(root, listFiles(root));
  return [
    ...trackedDependencies(root),
    ...auditPaths(root, selected),
    ...auditContent(root, selected),
    ...findDuplicateExports(root, selected),
    ...auditTsconfigs(root),
  ];
}

/** Rules a correct agent breaks between two calls: a domain rule is written one call before its test. */
const DONE_ONLY_RULES = new Set(["domain-test"]);

/** The changed files only: the rules that read nothing else. Fast and the post-command audit run this; duplicate exports wait for Done. */
export function auditChanged(root: string, files: string[]): Finding[] {
  const selected = present(root, files);
  return [...auditPaths(root, selected), ...auditContent(root, selected)].filter((finding) => !DONE_ONLY_RULES.has(finding.rule));
}
