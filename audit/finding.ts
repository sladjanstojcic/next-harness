export interface Finding {
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export function formatFindings(findings: Finding[]): string {
  return findings.map(({ file, line, rule, message }) => `${file}:${line ?? 1} ${rule} — ${message}`).join("\n");
}
