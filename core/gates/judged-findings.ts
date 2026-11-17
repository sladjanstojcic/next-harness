import type { Finding } from "../audit/finding.ts";
import { ignoredPaths } from "../state/git-ignore.ts";

/** The findings a gate or the legacy list judges: none on a file git ignores, such as build output a tool read anyway. */
export function judgedFindings(root: string, findings: Finding[]): Finding[] {
  const ignored = ignoredPaths(root, [...new Set(findings.map((finding) => finding.file))]);
  return ignored.size === 0 ? findings : findings.filter((finding) => !ignored.has(finding.file));
}
