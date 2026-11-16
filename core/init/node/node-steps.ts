import path from "node:path";
import type { WorkspaceEntry } from "../../../config.ts";
import { compilerOptionsInForce } from "../../../tools/typescript.ts";
import { nodeTsconfigFindings } from "../../audit/tsconfig/tsconfig-node.ts";
import { isObject, readJson } from "../files.ts";

/** Node loads src/ as ES modules, and `#/` resolves through package.json, since Node applies no tsconfig paths. */
const IMPORTS = { "#/*": "./src/*" };

/**
 * The hand steps of a node-service workspace: its package.json makes src/ ES modules with the `#/` map, and its
 * tsconfig.json has the options Node runs TypeScript with. Init's own tsconfig step sets allowImportingTsExtensions,
 * in the eslint-prettier workspaces it writes configs for.
 */
function workspaceTodo(root: string, workspace: WorkspaceEntry): string[] {
  const dir = path.join(root, workspace.path);
  const label = (file: string): string => path.posix.join(workspace.path, file);
  const manifest = readJson(path.join(dir, "package.json"), label("package.json")) ?? {};
  const imports = isObject(manifest.imports) ? manifest.imports : {};
  const esModules = manifest.type === "module" && imports["#/*"] === IMPORTS["#/*"];
  const options = compilerOptionsInForce(path.join(dir, "tsconfig.json")) ?? {};
  const findings = nodeTsconfigFindings("tsconfig.json", options);
  const hasPaths = (message: string): boolean => message.startsWith("compilerOptions.paths ");
  const initSets = workspace.tools === "eslint-prettier" ? "allowImportingTsExtensions" : undefined;
  const missing = findings
    .filter(({ message }) => !hasPaths(message))
    .map(({ message }) => /set (.*?), since/.exec(message)?.[1] ?? "")
    .filter((setting) => setting !== "" && (initSets === undefined || !setting.includes(initSets)));
  return [
    ...(esModules
      ? []
      : [
          `Make Node load src/ as ES modules and resolve #/ to it (init does not edit ${label("package.json")}): add "type": "module" and "imports": ${JSON.stringify(IMPORTS)}`,
        ]),
    ...(missing.length === 0
      ? []
      : [`Set the compiler options Node runs TypeScript with (init does not edit them in ${label("tsconfig.json")}): ${missing.join(", ")}`]),
    ...(findings.some(({ message }) => hasPaths(message))
      ? [
          `Remove "paths" from compilerOptions (init does not edit ${label("tsconfig.json")}) and import through package.json "imports" (#/*): Node does not apply tsconfig paths`,
        ]
      : []),
  ];
}

/** The hand steps of every node-service workspace, for init's numbered list. */
export function nodeTodo(root: string, workspaces: readonly WorkspaceEntry[]): string[] {
  return workspaces.filter((workspace) => workspace.shape === "node-service").flatMap((workspace) => workspaceTodo(root, workspace));
}
