import { existsSync } from "node:fs";
import { join } from "node:path";
import { classify, readLegacy } from "../classes.ts";
import { resolveHarness } from "../path-check.ts";
import { auditContent } from "./content-rules.ts";
import { findDuplicateExports } from "./duplicate-exports.ts";
import type { Finding } from "./finding.ts";
import { listFiles } from "./list-files.ts";
import { auditPaths } from "./path-rules.ts";

/** Vendored files are exempt and upstream files are not the harness's to judge; legacy files are audited and reported as pre-existing. */
function present(root: string, files: string[]): string[] {
  const harness = resolveHarness(root);
  const legacy = readLegacy(root, harness.config);
  return files.filter((file) => {
    const pathClass = classify(file, harness, legacy);
    return pathClass !== "vendored" && pathClass !== "upstream" && existsSync(join(root, file));
  });
}

/** The whole repository: every rule, including the ones that need the full inventory. Done and CI run this. */
export function audit(root: string): Finding[] {
  const selected = present(root, listFiles(root));
  return [...auditPaths(root, selected), ...auditContent(root, selected), ...findDuplicateExports(root, selected)];
}

/** The changed files only: the rules that read nothing else. Fast and the post-command audit run this; duplicate exports wait for Done. */
export function auditChanged(root: string, files: string[]): Finding[] {
  const selected = present(root, files);
  return [...auditPaths(root, selected), ...auditContent(root, selected)];
}
