import fs from "node:fs";
import path from "node:path";
import { DESIGN_RULES, designRulesFile, hasInterface } from "../../design-rules.ts";
import type { Harness } from "../../path-check.ts";
import { writer, type Step } from "../files.ts";

const DEFAULT_RULES = path.resolve(import.meta.dirname, "../../../presets/design-rules.md");
const lf = (text: string): string => text.replace(/\r\n/g, "\n");

/**
 * Writes the harness's default design rules at the root of a project with an interface and no rules of its own. The
 * project's own file is never replaced, and one init cannot read is reported and left alone.
 */
export function designRulesSteps(root: string, workspaces: Harness["workspaces"]): Step[] {
  if (!workspaces.some((workspace) => hasInterface(root, workspace))) return [];
  const own = designRulesFile(root);
  const text = fs.readFileSync(DEFAULT_RULES, "utf8");
  if (own === undefined)
    return [{ target: DESIGN_RULES, status: "created", detail: "default design rules", apply: writer(path.join(root, DESIGN_RULES), text) }];
  let current: string;
  try {
    current = fs.readFileSync(path.join(root, own), "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "an error";
    return [{ target: own, status: "kept", detail: `cannot be read (${code}); init leaves it alone` }];
  }
  if (lf(current) === lf(text)) return [{ target: own, status: "unchanged", detail: "default design rules" }];
  return [{ target: own, status: "kept", detail: "your design rules stay" }];
}
