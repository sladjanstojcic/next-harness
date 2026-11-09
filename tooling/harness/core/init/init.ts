import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { codexHooksSetting, withHooksFeature } from "./codex-user.ts";
import { compareHooks, hooksBlock, mergeHooks, type HooksBlock } from "./hooks-merge.ts";
import { CI_STEPS, CLAUDE_HOOKS, CODEX_CONFIG, CODEX_HOOKS, HOOKS_PATH, PACKAGE_SCRIPTS, PRE_PUSH } from "./wiring.ts";

type Status = "created" | "updated" | "unchanged" | "conflict";

interface Step {
  target: string;
  status: Status;
  detail: string;
  apply?: () => void;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string, label: string): JsonObject | undefined {
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

function indentOf(file: string): string {
  const match = /^([ \t]+)"/m.exec(fs.readFileSync(file, "utf8"));
  return match?.[1] ?? "  ";
}

function writer(file: string, text: string, mode?: number): () => void {
  return () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (mode !== undefined) fs.chmodSync(file, mode);
  };
}

function hooksStep(root: string, label: string, wanted: HooksBlock, force: boolean): Step {
  const file = path.join(root, label);
  const current = readJson(file, label);
  const write = (value: JsonObject) => writer(file, `${JSON.stringify(value, null, current === undefined ? 2 : indentOf(file))}\n`);
  if (current === undefined) return { target: label, status: "created", detail: "hooks", apply: write({ hooks: wanted }) };
  if (current.hooks === undefined)
    return { target: label, status: "updated", detail: "hooks added, other keys kept", apply: write({ ...current, hooks: wanted }) };
  const parsed = hooksBlock.safeParse(current.hooks);
  if (!parsed.success) throw new Error(`${label} holds a hooks block init cannot read: ${parsed.error.message}`);
  const { differing, hasHarness, kept } = compareHooks(parsed.data, wanted);
  const others = `${String(kept)} other hook ${kept === 1 ? "entry" : "entries"}`;
  if (differing.length === 0) return { target: label, status: "unchanged", detail: kept === 0 ? "hooks" : `hooks, ${others}` };
  const apply = write({ ...current, hooks: mergeHooks(parsed.data, wanted) });
  const events = differing.join(", ");
  if (!hasHarness) return { target: label, status: "updated", detail: `harness hooks added, ${others} kept`, apply };
  if (!force)
    return {
      target: label,
      status: "conflict",
      detail: `harness hooks differ in ${events}; --force replaces them there and keeps ${others}`,
    };
  return { target: label, status: "updated", detail: `harness hooks replaced in ${events}, ${others} kept`, apply };
}

function codexConfigStep(root: string, force: boolean): Step {
  const label = ".codex/config.toml";
  const file = path.join(root, label);
  if (!fs.existsSync(file)) return { target: label, status: "created", detail: "[features] hooks = true", apply: writer(file, CODEX_CONFIG) };
  const text = fs.readFileSync(file, "utf8");
  const setting = codexHooksSetting(text);
  if (setting === "on") return { target: label, status: "unchanged", detail: "[features] hooks = true" };
  if (setting === "off" && !force) return { target: label, status: "conflict", detail: "[features] sets hooks to another value; --force sets it to true" };
  return { target: label, status: "updated", detail: "[features] hooks = true, other settings kept", apply: writer(file, withHooksFeature(text)) };
}

function prePushStep(root: string, force: boolean): Step {
  const label = `${HOOKS_PATH}/pre-push`;
  const file = path.join(root, label);
  const apply = writer(file, PRE_PUSH, 0o755);
  if (!fs.existsSync(file)) return { target: label, status: "created", detail: "runs the CI gate", apply };
  if (fs.readFileSync(file, "utf8") !== PRE_PUSH) {
    if (!force) return { target: label, status: "conflict", detail: "holds a different hook; --force replaces it" };
    return { target: label, status: "updated", detail: "replaced", apply };
  }
  if ((fs.statSync(file).mode & 0o111) === 0) return { target: label, status: "updated", detail: "made executable", apply };
  return { target: label, status: "unchanged", detail: "runs the CI gate" };
}

function hooksPathStep(root: string, force: boolean): Step {
  const label = "git config core.hooksPath";
  const read = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  if (read.status !== 0 && read.status !== 1) throw new Error(`git config core.hooksPath cannot be read: ${read.stderr.trim()}`);
  const current = read.stdout.trim();
  const apply = () => {
    const result = spawnSync("git", ["config", "--local", "core.hooksPath", HOOKS_PATH], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git config core.hooksPath failed: ${result.stderr.trim()}`);
  };
  if (current === HOOKS_PATH) return { target: label, status: "unchanged", detail: HOOKS_PATH };
  if (current === "") return { target: label, status: "created", detail: HOOKS_PATH, apply };
  if (!force) return { target: label, status: "conflict", detail: `is ${current}; --force sets it to ${HOOKS_PATH}` };
  return { target: label, status: "updated", detail: `${current} replaced by ${HOOKS_PATH}`, apply };
}

function scriptsStep(root: string, force: boolean): Step {
  const label = "package.json";
  const file = path.join(root, label);
  const pkg = readJson(file, label);
  if (pkg === undefined) throw new Error(`No ${label} at ${root}; init adds the harness scripts to it.`);
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {};
  const names = Object.keys(PACKAGE_SCRIPTS);
  const missing = names.filter((name) => scripts[name] === undefined);
  const different = names.filter((name) => scripts[name] !== undefined && scripts[name] !== PACKAGE_SCRIPTS[name]);
  if (missing.length === 0 && different.length === 0) return { target: label, status: "unchanged", detail: `scripts ${names.join(", ")}` };
  if (different.length > 0 && !force) return { target: label, status: "conflict", detail: `scripts ${different.join(", ")} differ; --force replaces them` };
  const next = { ...pkg, scripts: { ...scripts, ...PACKAGE_SCRIPTS } };
  const changed = [...different, ...missing].join(", ");
  return { target: label, status: "updated", detail: `scripts ${changed}`, apply: writer(file, `${JSON.stringify(next, null, indentOf(file))}\n`) };
}

/** Writes the harness wiring every consumer shares; nothing is written while a step conflicts and force is off. The git config step applies first, so a git failure precedes any file write. */
export function initHarness(root: string, force: boolean): { report: string; ok: boolean } {
  const steps = [
    hooksPathStep(root, force),
    hooksStep(root, ".claude/settings.json", CLAUDE_HOOKS, force),
    hooksStep(root, ".codex/hooks.json", CODEX_HOOKS, force),
    codexConfigStep(root, force),
    prePushStep(root, force),
    scriptsStep(root, force),
  ];
  const lines = steps.map((step) => `${step.status} ${step.target}: ${step.detail}`);
  if (steps.some((step) => step.status === "conflict")) {
    return { report: [...lines, "Nothing was written. Rerun with --force to replace the conflicting wiring."].join("\n"), ok: false };
  }
  for (const step of steps) step.apply?.();
  return { report: [...lines, CI_STEPS].join("\n"), ok: true };
}
