import fs from "node:fs";
import path from "node:path";
import type { Finding } from "../../audit/finding.ts";
import { blockIn, harnessBlock, sameBlock } from "./agents-block.ts";

const AGENTS = "AGENTS.md";
const MESSAGE = "The harness rules in AGENTS.md are missing or out of date. Run: node tooling/harness/cli.ts init";

/** An agent reads the rules from AGENTS.md: a missing, broken or stale block means it works from rules the guards no longer hold. */
export function auditAgentsBlock(root: string): Finding[] {
  const file = path.join(root, AGENTS);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [{ rule: "agents-block", file: AGENTS, message: MESSAGE }];
  }
  const range = blockIn(text);
  if (typeof range !== "string" && sameBlock(text.slice(range.start, range.end), harnessBlock(root))) return [];
  return [{ rule: "agents-block", file: AGENTS, message: MESSAGE }];
}
