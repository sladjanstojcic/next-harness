import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { analysisOf, type HarnessConfig, type WorkspaceEntry } from "../../config.ts";
import { managerCommands } from "./bootstrap.ts";
import { lacksTypescriptApi, TYPESCRIPT_API } from "../../presets/load-tool.ts";
import { broughtByBase, bringsOwnBase, bringsOwnNext } from "../../tools/eslint-preset.ts";
import { runsOwnTests } from "./tool-configs.ts";

const HARNESS = path.resolve(import.meta.dirname, "../..");

const NEEDS = ["eslint-config", "eslint-config-next", "vitest", "browser", "depcruise", "knip", "jscpd"] as const;
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

const inWorkspace = (workspace: WorkspaceEntry, command: string): string => (workspace.path === "" ? command : `cd ${workspace.path} && ${command}`);

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

/** What the workspace uses of the harness's tools: a tool tied to a part the workspace does not use is not asked for. */
function needs(root: string, config: HarnessConfig, workspace: WorkspaceEntry): ReadonlySet<Need> {
  const needed = new Set<Need>(analysisOf(config, workspace));
  const dir = path.join(root, workspace.path);
  if (!bringsOwnBase(dir)) {
    needed.add("eslint-config");
    if (workspace.next && !bringsOwnNext(dir)) needed.add("eslint-config-next");
  }
  if (runsOwnTests(root, workspace) === undefined) needed.add("vitest");
  if (workspace.path === "" && workspace.next) needed.add("browser");
  return needed;
}

/** Whether the `typescript` the workspace resolves is 7 or newer, which the lint preset's typescript-eslint cannot use. */
export const needsTypescriptApi = (root: string, workspace: WorkspaceEntry): boolean => lacksTypescriptApi(path.join(root, workspace.path));

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
  const packages = [...missing.map(([name, peer]) => `${name}@${peer.version}`), ...(needsTypescriptApi(root, workspace) ? [`"${TYPESCRIPT_API}"`] : [])];
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
