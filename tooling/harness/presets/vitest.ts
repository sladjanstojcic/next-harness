import fs from "node:fs";
import path from "node:path";

function serverOnlyEntry(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const entry = path.join(dir, "node_modules/server-only/empty.js");
    if (fs.existsSync(entry) || dir === path.dirname(dir)) return entry;
  }
}

export interface HarnessVitestOptions {
  /** A new project has no tests yet; the harness's own repository passes false so a vanished suite fails. */
  passWithNoTests?: boolean;
}

/** Vitest for a workspace, run from its folder: unit tests in src/, or in app/, modules/ and shared/ without it, and in scripts/; never the harness's own. */
export function harnessVitest({ passWithNoTests = true }: HarnessVitestOptions = {}) {
  return {
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      // Use the package's server entry in tests without changing React's resolution conditions.
      alias: { "server-only": serverOnlyEntry() },
      include: ["src/**/*.test.{ts,tsx}", "{app,modules,shared}/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
      environment: "node",
      passWithNoTests,
      // Most tests spawn git, Node or the real tools; the 5 s default fails them on a loaded machine.
      testTimeout: 30_000,
    },
  };
}
