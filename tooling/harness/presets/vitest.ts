import fs from "node:fs";
import path from "node:path";
import { expandWorkspaces, loadConfig } from "../config.ts";
import { serverPackages, withoutServerCondition } from "../shapes/node/server-condition.ts";

const EMPTY_ENTRY = "node_modules/server-only/empty.js";

function serverOnlyEntry(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const entry = path.join(dir, EMPTY_ENTRY);
    if (fs.existsSync(entry) || dir === path.dirname(dir)) return entry;
  }
}

/** The repository root, found from the folder Vitest runs in: the nearest folder above that holds this preset. */
function repositoryRoot(): string | undefined {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "tooling/harness/presets/vitest.ts"))) return dir;
    if (dir === path.dirname(dir)) return undefined;
  }
}

/**
 * "server-only" in tests. An app or a package gets the empty entry, without changing React's resolution conditions.
 * A node-service that depends on a package with a src/server.ts gets it only while every start of the service passes
 * the react-server condition: otherwise the real entry throws in the test, as it would when the service starts.
 */
function serverOnlyAlias(): Record<string, string> {
  const root = repositoryRoot();
  const dir = process.cwd();
  const workspaces = root === undefined ? [] : expandWorkspaces(root, loadConfig(root));
  const service = root !== undefined && workspaces.some((workspace) => workspace.shape === "node-service" && path.join(root, workspace.path) === dir);
  const packages = service && root !== undefined ? serverPackages(root, workspaces, dir) : [];
  if (packages.length === 0) return { "server-only": serverOnlyEntry() };
  if (withoutServerCondition(dir).length > 0) return {};
  const entry = [serverOnlyEntry(), ...packages.map((found) => path.join(found.dir, EMPTY_ENTRY))].find((file) => fs.existsSync(file));
  return entry === undefined ? {} : { "server-only": entry };
}

export interface HarnessVitestOptions {
  /** A new project has no tests yet; the harness's own repository passes false so a vanished suite fails. */
  passWithNoTests?: boolean;
  /** False leaves out the integration tests (`*.int.test.ts`), which need a running backend; a node-service or vite-spa workspace runs them with a config of its own. */
  integration?: boolean;
}

/** Vitest for a workspace, run from its folder: unit tests in src/, or in app/, modules/ and shared/ without it, and in scripts/; never the harness's own. */
export function harnessVitest({ passWithNoTests = true, integration = true }: HarnessVitestOptions = {}) {
  return {
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      alias: serverOnlyAlias(),
      include: ["src/**/*.test.{ts,tsx}", "{app,modules,shared}/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
      // Vitest's own default exclusions, kept when the integration tests are left out too.
      ...(integration ? {} : { exclude: ["**/node_modules/**", "**/.git/**", "**/*.int.test.ts"] }),
      environment: "node",
      passWithNoTests,
      // Most tests spawn git, Node or the real tools; the 5 s default fails them on a loaded machine.
      testTimeout: 30_000,
    },
  };
}
