import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { analysisOf, buildsNext, type HarnessConfig, type WorkspaceEntry } from "../../config.ts";
import { managerCommands } from "./bootstrap.ts";
import { lacksTypescriptApi, TYPESCRIPT_API, typescriptNative, typescriptVersion } from "../../presets/load-tool.ts";
import { broughtByBase, bringsOwnBase, bringsOwnNext } from "../../tools/eslint-preset.ts";
import { bin } from "../../tools/tool-set.ts";
import { isLintOnly } from "./lint-only/lint-only.ts";
import { runsOwnTests } from "./tool-configs.ts";

const HARNESS = path.resolve(import.meta.dirname, "../..");

const NEEDS = ["eslint-config", "eslint-config-next", "vitest", "browser", "accessibility", "depcruise", "knip", "jscpd"] as const;
type Need = (typeof NEEDS)[number];

/**
 * The tools whose rules presets/ holds: the template's version, the oldest version the presets work with, and what a
 * workspace must use for the tool to be needed at all. They are not peerDependencies: a kit's `manypkg fix` copies peers
 * into devDependencies of the vendored package.
 */
const PEERS = z
  .record(z.string(), z.strictObject({ version: z.string(), minimum: z.string(), when: z.enum(NEEDS).exactOptional() }))
  .parse(JSON.parse(fs.readFileSync(path.join(HARNESS, "presets/peers.json"), "utf8")));

const manifest = z.object({
  version: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const readManifest = (file: string) => manifest.parse(JSON.parse(fs.readFileSync(file, "utf8")));

/** The version of an `npm:<name>@<version>` alias, which keeps manypkg's external-mismatch fix off the harness's pins. */
const aliasVersion = (spec: string): string => spec.replace(/^npm:(?:@[^@/]+\/)?[^@]+@/, "");

/** server-only is the starter's other runtime dependency; the harness itself does not import it. */
const STARTER_RUNTIME: Readonly<Record<string, string>> = { "server-only": "0.0.1" };

const inWorkspace = (workspace: WorkspaceEntry, command: string): string => (workspace.path === "" ? command : `(cd ${workspace.path} && ${command})`);

/** The version a node_modules folder between the workspace and the git root provides, or undefined. */
function reachableVersion(root: string, workspace: WorkspaceEntry, name: string): string | undefined {
  for (let dir = path.join(root, workspace.path); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(file)) return readManifest(file).version ?? "";
    if (path.relative(root, dir) === "") return undefined;
  }
}

const numbers = (version: string): number[] => (/^\D*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version)?.slice(1) ?? []).map((part) => Number(part ?? 0));

/** Whether a version is at or above a minimum, by major, minor and patch; an unreadable version is not. */
export function atLeast(version: string, minimum: string): boolean {
  const [have, want] = [numbers(version), numbers(minimum)];
  if (have.length === 0) return false;
  for (const [index, wanted] of want.entries()) {
    const part = have[index] ?? 0;
    if (part !== wanted) return part > wanted;
  }
  return true;
}

/** The starter test that runs axe on the home page; while a Next app the gates build has it, init asks for @axe-core/playwright. */
const ACCESSIBILITY_TEST = "e2e/accessibility.test.ts";

/** What the workspace uses of the harness's tools: a tool tied to a part the workspace does not use is not asked for. */
function needs(root: string, config: HarnessConfig, workspace: WorkspaceEntry): ReadonlySet<Need> {
  const needed = new Set<Need>(analysisOf(config, workspace));
  const dir = path.join(root, workspace.path);
  if (!bringsOwnBase(dir)) {
    needed.add("eslint-config");
    if (workspace.next && !bringsOwnNext(dir)) needed.add("eslint-config-next");
  }
  if (!isLintOnly(workspace) && runsOwnTests(root, workspace) === undefined) needed.add("vitest");
  if (buildsNext(workspace)) {
    needed.add("browser");
    if (fs.existsSync(path.join(dir, ACCESSIBILITY_TEST))) needed.add("accessibility");
  }
  return needed;
}

/** Whether the `typescript` the workspace resolves is 7 or newer, which the lint preset's typescript-eslint cannot use. */
export const needsTypescriptApi = (root: string, workspace: WorkspaceEntry): boolean => lacksTypescriptApi(path.join(root, workspace.path));

/**
 * The workspace's TypeScript 7 version when the alias would take its only `tsc`: no folder above the workspace, up to the
 * git root, holds a typescript. create-turbo keeps one at its root; a project at the root has no folder above.
 */
export function nativeTypescript(root: string, workspace: WorkspaceEntry): string | undefined {
  if (!needsTypescriptApi(root, workspace)) return undefined;
  for (let dir = path.join(root, workspace.path); path.relative(root, dir) !== "";) {
    dir = path.dirname(dir);
    if (fs.existsSync(path.join(dir, "node_modules/typescript/package.json"))) return undefined;
  }
  return typescriptVersion(path.join(root, workspace.path));
}

/**
 * The install line for the tools the workspace needs and no folder up to the git root provides at the harness's minimum
 * or above. An installed tool at or above the minimum stays as it is, also when it is newer than the template's; init
 * does not install.
 */
export function peerInstall(root: string, config: HarnessConfig, workspace: WorkspaceEntry): string | undefined {
  const needed = needs(root, config, workspace);
  // A second copy beside the one the project's own lint config runs could be a version its TypeScript refuses.
  const brought = broughtByBase(path.join(root, workspace.path));
  const missing = Object.entries(PEERS).filter(
    ([name, peer]) =>
      (peer.when === undefined || needed.has(peer.when)) && !brought.includes(name) && !atLeast(reachableVersion(root, workspace, name) ?? "", peer.minimum),
  );
  const native = nativeTypescript(root, workspace);
  const packages = [
    ...missing.map(([name, peer]) => `${name}@${peer.version}`),
    ...(needsTypescriptApi(root, workspace) ? [`"${TYPESCRIPT_API}"`] : []),
    ...(native === undefined ? [] : [typescriptNative(native)]),
  ];
  if (packages.length === 0) return undefined;
  return inWorkspace(workspace, `${managerCommands(root).addDev} ${packages.join(" ")}`);
}

/** The install line for the runtime packages the starter files import and the workspace's package.json does not declare. */
export function starterInstall(root: string, workspace: WorkspaceEntry): string | undefined {
  const { dependencies: harness = {} } = readManifest(path.join(HARNESS, "package.json"));
  const { dependencies = {}, devDependencies = {} } = readManifest(path.join(root, workspace.path, "package.json"));
  const wanted = { zod: aliasVersion(harness.zod ?? ""), ...STARTER_RUNTIME };
  const missing = Object.entries(wanted).filter(([name]) => dependencies[name] === undefined && devDependencies[name] === undefined);
  if (missing.length === 0) return undefined;
  return inWorkspace(workspace, `${managerCommands(root).add} ${missing.map(([name, version]) => `${name}@${version}`).join(" ")}`);
}

/**
 * A tool's command run from a workspace folder. The manager's exec runs in the nearest folder with a package.json, so a
 * folder without one gets the binary by its path: the nearest node_modules/.bin that has it, or before the install, the
 * one beside the nearest package.json above the folder.
 */
export function toolCommand(root: string, folder: string, tool: string, args: string): string {
  const exec = `${managerCommands(root).exec} ${tool} ${args}`;
  if (folder === "") return exec;
  const dir = path.join(root, folder);
  if (fs.existsSync(path.join(dir, "package.json"))) return `(cd ${folder} && ${exec})`;
  let owner = path.dirname(dir);
  while (owner !== root && !fs.existsSync(path.join(owner, "package.json"))) owner = path.dirname(owner);
  const binary = bin(dir, tool, root) ?? bin(owner, tool);
  return `(cd ${folder} && ${path.relative(dir, binary).split(path.sep).join("/")} ${args})`;
}

/** Playwright's command in the first Next app the gates build, whose browser install serves the others; undefined without one. */
export const browserCommand = (root: string, workspaces: readonly WorkspaceEntry[], args: string): string | undefined =>
  workspaces.filter(buildsNext).map((workspace) => toolCommand(root, workspace.path, "playwright", args))[0];
