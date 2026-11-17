import type { Finding } from "../audit/finding.ts";
import { ALWAYS_BLOCKS, HARNESS_RULES } from "../classes.ts";
import { type Applied, isAppliedMigration, isMigration } from "../hooks/migration-guard.ts";
import type { Harness } from "../path-check.ts";
import { ignoredPaths } from "../state/git-ignore.ts";

/** The findings a gate or the legacy list judges: none on a file git ignores, such as build output a tool read anyway. */
export function judgedFindings(root: string, findings: Finding[]): Finding[] {
  const ignored = ignoredPaths(root, [...new Set(findings.map((finding) => finding.file))]);
  return ignored.size === 0 ? findings : findings.filter((finding) => !ignored.has(finding.file));
}

/**
 * Whether a tool finding is on an applied migration, which the migration lock keeps anyone from fixing: it is reported
 * as pre-existing and never blocks. A migration the applied commits do not hold is judged in full.
 */
export function onAppliedMigration(root: string, harness: Harness, resolve: () => Applied): (finding: Finding) => boolean {
  const known = new Map<string, boolean>();
  let applied: Applied | undefined;
  return (finding) => {
    if (finding.file === "" || HARNESS_RULES.has(finding.rule) || ALWAYS_BLOCKS(finding) || !isMigration(harness, finding.file)) return false;
    const answer = known.get(finding.file) ?? isAppliedMigration(root, finding.file, (applied ??= resolve()));
    known.set(finding.file, answer);
    return answer;
  };
}
