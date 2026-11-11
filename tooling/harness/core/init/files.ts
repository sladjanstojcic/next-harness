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

/**
 * Adds the missing scripts; `defaults` are only ever added. A project's own script under a `required` name stays, and
 * the step prints the harness's line for it, since pre-push and CI call the gate directly; with force it is replaced.
 */
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
  const own = force ? [] : different;
  const lines = own.map((name) => `\n    "${name}": "${required[name] ?? ""}"`).join("");
  const kept =
    own.length === 0 ? "" : `your ${own.join(", ")} ${own.length === 1 ? "script stays" : "scripts stay"}; the harness's, which --force writes:${lines}`;
  const changed = [...(force ? different : []), ...missing];
  if (changed.length === 0) return { target: label, status: "kept", detail: kept };
  const next = { ...pkg, scripts: { ...scripts, ...Object.fromEntries(changed.map((name) => [name, wanted[name]])) } };
  const detail = `scripts ${changed.join(", ")}${kept === "" ? "" : `; ${kept}`}`;
  return { target: label, status: "updated", detail, apply: writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`) };
}

const STARTER = path.resolve(import.meta.dirname, "../../presets/starter");

/** Copies the starter files kept under presets/starter/<set>/ as `.txt` into a folder of the repository, never over a changed file. */
export function starterSteps(root: string, set: string, folder: string): Step[] {
  return fs
    .readdirSync(path.join(STARTER, set))
    .sort()
    .map((name) => {
      const target = `${folder}/${name.replace(/\.txt$/, "")}`;
      const text = fs.readFileSync(path.join(STARTER, set, name), "utf8");
      const file = path.join(root, target);
      if (!fs.existsSync(file)) return { target, status: "created", detail: "starter file", apply: writer(file, text) };
      return fs.readFileSync(file, "utf8") === text
        ? { target, status: "unchanged", detail: "starter file" }
        : { target, status: "kept", detail: "your file stays; the harness's starter copy differs" };
    });
}
