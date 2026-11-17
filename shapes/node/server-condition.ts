import fs from "node:fs";
import path from "node:path";
import type { WorkspaceEntry } from "../../config.ts";

/**
 * The flag Node needs to load "server-only", which a package's src/server.ts imports: only under the react-server
 * condition does that package resolve to its empty entry, and plain Node throws on the import.
 */
export const SERVER_CONDITION = "--conditions=react-server";
const HAS_CONDITION = /(?:--conditions[= ]|-C )react-server\b/;
/** Node started on the service's own source, as a shell command or in a Dockerfile's JSON array. */
const RUNS_SOURCE = /\bnode\b[^;&|\n]*\bsrc\//;

function manifestOf(dir: string): Record<string, unknown> {
  const file = path.join(dir, "package.json");
  const value: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return typeof value === "object" && value !== null ? { ...value } : {};
}

const keysOf = (value: unknown): string[] => (typeof value === "object" && value !== null ? Object.keys(value) : []);

/** The package workspaces with a src/server.ts that the folder's package.json depends on: their names and folders. */
export function serverPackages(root: string, workspaces: readonly WorkspaceEntry[], dir: string): { name: string; dir: string }[] {
  const manifest = manifestOf(dir);
  const listed = new Set([...keysOf(manifest.dependencies), ...keysOf(manifest.devDependencies)]);
  return workspaces
    .filter((workspace) => workspace.shape === "package" && fs.existsSync(path.join(root, workspace.path, "src/server.ts")))
    .map((workspace) => ({ name: manifestOf(path.join(root, workspace.path)).name, dir: path.join(root, workspace.path) }))
    .flatMap(({ name, dir: folder }) => (typeof name === "string" && listed.has(name) ? [{ name, dir: folder }] : []));
}

/** Where a folder starts Node on src/ without the condition: a package script, or a CMD or ENTRYPOINT line of its Dockerfile. */
export function withoutServerCondition(dir: string): { file: string; where: string; line?: number }[] {
  const scripts = manifestOf(dir).scripts;
  const commands = typeof scripts === "object" && scripts !== null ? Object.entries(scripts) : [];
  const plain = (command: unknown): boolean => typeof command === "string" && RUNS_SOURCE.test(command) && !HAS_CONDITION.test(command);
  const docker = path.join(dir, "Dockerfile");
  const lines = fs.existsSync(docker) ? fs.readFileSync(docker, "utf8").split("\n") : [];
  return [
    ...commands.filter(([, command]) => plain(command)).map(([name]) => ({ file: "package.json", where: `The "${name}" script` })),
    ...lines.flatMap((text, index) =>
      /^\s*(?:CMD|ENTRYPOINT)\b/.test(text) && plain(text) ? [{ file: "Dockerfile", where: "This line", line: index + 1 }] : [],
    ),
  ];
}
