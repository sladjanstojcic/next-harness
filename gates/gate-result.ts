import type { Finding } from "../audit/finding.ts";

export interface GateResult {
  passed: boolean;
  findings: Finding[];
  preExisting: Finding[];
  report: string;
}
