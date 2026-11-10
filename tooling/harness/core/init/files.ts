import fs from "node:fs";
import path from "node:path";

/** `kept` marks a project file init never replaces; its detail says what to add by hand. */
type Status = "created" | "updated" | "unchanged" | "kept" | "conflict";

export interface Step {
  target: string;
  status: Status;
  detail: string;
  apply?: () => void;
  /** A kept file whose detail names a change the user makes by hand. */
  todo?: boolean;
}

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJson(file: string, label: string): JsonObject | undefined {
  if (!fs.existsSync(file)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(value)) throw new Error(`${label} must hold a JSON object.`);
  return value;
}

export function indentOf(file: string): string {
  const match = /^([ \t]+)"/m.exec(fs.readFileSync(file, "utf8"));
  return match?.[1] ?? "  ";
}

export function writer(file: string, text: string, mode?: number): () => void {
  return () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (mode !== undefined) fs.chmodSync(file, mode);
  };
}

/** Adds the missing scripts and, with force, replaces the differing `required` ones; `defaults` are only ever added. */
export function scriptsStep(
  root: string,
  label: string,
  required: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, string>>,
  force: boolean,
): Step {
  const file = path.join(root, label);
  const pkg = readJson(file, label);
  if (pkg === undefined) throw new Error(`No ${label} at ${root}; init adds the harness scripts to it.`);
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {};
  const wanted = { ...defaults, ...required };
  const names = Object.keys(wanted);
  const missing = names.filter((name) => scripts[name] === undefined);
  const different = Object.keys(required).filter((name) => scripts[name] !== undefined && scripts[name] !== required[name]);
  if (missing.length === 0 && different.length === 0) return { target: label, status: "unchanged", detail: `scripts ${names.join(", ")}` };
  if (different.length > 0 && !force) return { target: label, status: "conflict", detail: `scripts ${different.join(", ")} differ; --force replaces them` };
  const added = Object.fromEntries(missing.map((name) => [name, wanted[name]]));
  const replaced = Object.fromEntries(different.map((name) => [name, required[name]]));
  const next = { ...pkg, scripts: { ...scripts, ...added, ...replaced } };
  const changed = [...different, ...missing].join(", ");
  return { target: label, status: "updated", detail: `scripts ${changed}`, apply: writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`) };
}
