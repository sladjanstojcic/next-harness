import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { managerCommands } from "./bootstrap.ts";
import { codexHooksSetting, withHooksFeature } from "./codex-user.ts";
import { compareHooks, hooksBlock, mergeHooks, type HooksBlock } from "./hooks-merge.ts";
import { indentOf, isObject, readJson, scriptsStep, writer, type JsonObject, type Step } from "./files.ts";
import { resolveHarness } from "../path-check.ts";
import { bin } from "../../tools/tool-set.ts";
import { gitignoreStep, HARNESS_MODULES, rootIgnoreSteps } from "./ignore-files.ts";
import { peerInstall, starterInstall, toolConfigSteps, toolScripts } from "./tool-configs.ts";
import type { WorkspaceEntry } from "../../config.ts";
import { CI_STEPS, CLAUDE_HOOKS, CODEX_CONFIG, CODEX_HOOKS, HOOKS_PATH, PACKAGE_SCRIPTS, PRE_PUSH, PREPARE } from "./wiring.ts";

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

/** JSON.stringify spreads short arrays over lines; the project's Prettier formats what init rewrote, or the next steps' format run does. */
function formatJson(root: string, files: string[]): string[] {
  if (files.length === 0) return [];
  const manual = `run prettier --write ${files.join(" ")}`;
  const byBinary = new Map<string, string[]>();
  for (const file of files) {
    const prettier = bin(path.join(root, path.dirname(file)), "prettier", root);
    if (prettier === undefined) return [];
    byBinary.set(prettier, [...(byBinary.get(prettier) ?? []), file]);
  }
  for (const [prettier, own] of byBinary) {
    const result = spawnSync(prettier, ["--write", ...own], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) return [`prettier --write failed: ${(result.stderr || result.stdout).trim()}; ${manual}`];
  }
  return [`formatted ${files.join(", ")} with prettier`];
}

/** Whether the root "prepare" script, which installs run on a fresh clone, points git at the harness's hooks. */
function preparesHooks(root: string): boolean {
  const scripts = readJson(path.join(root, "package.json"), "package.json")?.scripts;
  const prepare = isObject(scripts) ? scripts.prepare : undefined;
  return typeof prepare === "string" && prepare.includes(PREPARE);
}

/** One numbered list of what the user runs after init, in the order that works: tools before the files that need them. */
function nextSteps(root: string, workspaces: readonly WorkspaceEntry[], steps: readonly Step[], starter: boolean): string[] {
  const todo = steps.filter((step) => step.todo === true).map((step) => step.target);
  const { exec, run } = managerCommands(root);
  const format = workspaces.map((workspace) => (workspace.path === "" ? `${exec} prettier --write .` : `(cd ${workspace.path} && ${exec} prettier --write .)`));
  const items = [
    ...workspaces
      .flatMap((workspace) => peerInstall(root, workspace) ?? [])
      .map((command) => `Install the harness's tools (init does not install): ${command}`),
    ...(starter ? workspaces.filter((workspace) => workspace.shape === "next-modules") : [])
      .flatMap((workspace) => starterInstall(root, workspace) ?? [])
      .map((command) => `Install the runtime packages the starter files import: ${command}`),
    ...(todo.length === 0 ? [] : [`Make the change each kept file above asks for: ${todo.join(", ")}`]),
    ...(preparesHooks(root) ? [] : [`Add to the root package.json "prepare" script, so a fresh clone gets the pre-push hook: ${PREPARE}`]),
    ...(format.length === 0 ? [] : [`Format the app's own files once in the preset's style: ${format.join("; ")}`]),
    ...(workspaces.some((workspace) => workspace.path === "" && workspace.next)
      ? [`Install the smoke test's browser: ${exec} playwright install chromium`]
      : []),
    'Commit the result: git add -A && git commit -m "Add the harness"',
    `Run the full gate: ${run} check`,
  ];
  return ["Next steps, in this order:", ...items.map((item, index) => `  ${String(index + 1)}. ${item}`)];
}

export interface InitOptions {
  force: boolean;
  /** Copies the next-modules helper files the content rules point at into each next-modules workspace. */
  starter: boolean;
}

/**
 * Writes the harness wiring every consumer shares and each eslint-prettier workspace's tool configs; nothing is written
 * while a step conflicts and force is off. The git config step applies first, so a git failure precedes any file write.
 */
export function initHarness(root: string, { force, starter }: InitOptions): { report: string; ok: boolean } {
  const all = resolveHarness(root).workspaces;
  const workspaces = all.filter((workspace) => workspace.tools === "eslint-prettier");
  const atRoot = workspaces.find((workspace) => workspace.path === "");
  const steps = [
    hooksPathStep(root, force),
    hooksStep(root, ".claude/settings.json", CLAUDE_HOOKS, force),
    hooksStep(root, ".codex/hooks.json", CODEX_HOOKS, force),
    codexConfigStep(root, force),
    prePushStep(root, force),
    scriptsStep(root, "package.json", PACKAGE_SCRIPTS, { prepare: PREPARE, ...(atRoot === undefined ? {} : toolScripts(atRoot)) }, force),
    ...(atRoot === undefined ? [gitignoreStep(root, "", [HARNESS_MODULES])] : []),
    ...workspaces.flatMap((workspace) => [
      ...(workspace.path === "" ? [] : [scriptsStep(root, `${workspace.path}/package.json`, {}, toolScripts(workspace), force)]),
      ...toolConfigSteps(root, workspace, force, starter),
    ]),
    ...rootIgnoreSteps(root, all),
  ];
  const lines = steps.map((step) => `${step.status} ${step.target}: ${step.detail}`);
  if (steps.some((step) => step.status === "conflict")) {
    return { report: [...lines, "Nothing was written. Rerun with --force to replace the conflicting wiring."].join("\n"), ok: false };
  }
  for (const step of steps) step.apply?.();
  const formatted = formatJson(
    root,
    steps.filter((step) => step.apply !== undefined && step.target.endsWith(".json")).map((step) => step.target),
  );
  return { report: [...lines, ...formatted, CI_STEPS, ...nextSteps(root, workspaces, steps, starter)].join("\n"), ok: true };
}
