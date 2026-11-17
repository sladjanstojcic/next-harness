import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessVitest } from "../../../presets/vitest.ts";
import { makeRepo } from "../../../testing/temp-repo.ts";
import { auditServerCondition } from "./server-condition.ts";

afterEach(() => vi.restoreAllMocks());

const CONFIG =
  'export default { workspaces: [{ path: "apps/worker", shape: "node-service" }, { path: "apps/api", shape: "node-service" }, { path: "packages/db", shape: "package" }, { path: "packages/ui", shape: "package" }] };\n';
const manifest = (value: object): string => `${JSON.stringify(value)}\n`;
const WORKER = { name: "worker", type: "module", dependencies: { "@acme/db": "workspace:*", "@acme/ui": "workspace:*" } };
const EMPTY = "packages/db/node_modules/server-only/empty.js";

/** The repository's real path: the temp folder is a symlink on macOS, and the preset compares with the folder Vitest runs in. */
function monorepo(scripts: Record<string, string>, files: Record<string, string> = {}): string {
  const repo = makeRepo({
    "harness.config.ts": CONFIG,
    "tooling/harness/presets/vitest.ts": "",
    "apps/worker/package.json": manifest({ ...WORKER, scripts }),
    "apps/worker/src/main.ts": 'import { rows } from "@acme/db/server";\n\nrows();\n',
    "apps/api/package.json": manifest({ name: "api", type: "module", scripts: { start: "node src/main.ts" } }),
    "packages/db/package.json": manifest({ name: "@acme/db", dependencies: { "server-only": "0.0.1" } }),
    "packages/db/src/server.ts": 'import "server-only";\n\nexport const rows = (): number[] => [];\n',
    [EMPTY]: "",
    "packages/ui/package.json": manifest({ name: "@acme/ui" }),
    "packages/ui/src/index.ts": "export const label = 1;\n",
    ...files,
  });
  return fs.realpathSync(repo.root);
}

const aliasIn = (root: string, folder: string): unknown => {
  vi.spyOn(process, "cwd").mockReturnValue(`${root}/${folder}`);
  return harnessVitest({ integration: false }).test.alias;
};

describe("server-condition", () => {
  it("reports each start of a service on its source without the react-server condition, in scripts and the Dockerfile", () => {
    const repo = monorepo(
      { start: "node src/main.ts", dev: "node --watch --conditions=react-server src/main.ts", lint: "eslint .", seed: "node scripts/seed.ts" },
      { "apps/worker/Dockerfile": 'FROM node:24\nRUN node --version\nCMD ["node", "src/main.ts"]\n' },
    );
    const findings = auditServerCondition(repo);
    expect(findings.map(({ file, line, rule }) => `${file}:${String(line ?? 1)} ${rule}`)).toEqual([
      "apps/worker/package.json:1 server-condition",
      "apps/worker/Dockerfile:3 server-condition",
    ]);
    expect(findings[0]?.message).toBe(
      'The "start" script starts Node without --conditions=react-server, and this service depends on @acme/db, whose src/server.ts imports "server-only": plain Node throws on that import. Put --conditions=react-server after node (Node layout)',
    );
  });

  it("finds nothing once every start passes the condition, and nothing in a service that depends on no package with a server entry", () => {
    const repo = monorepo(
      { start: "node --conditions=react-server src/main.ts", dev: "node -C react-server --watch src/main.ts" },
      { "apps/worker/Dockerfile": 'CMD ["node", "--conditions=react-server", "src/main.ts"]\n' },
    );
    expect(auditServerCondition(repo)).toEqual([]);
  });

  it("gives the service's tests the empty server-only entry only while its starts pass the condition, as the runtime would", () => {
    const started = monorepo({ start: "node --conditions=react-server src/main.ts" });
    expect(aliasIn(started, "apps/worker")).toEqual({ "server-only": `${started}/${EMPTY}` });
    const plain = monorepo({ start: "node src/main.ts" });
    expect(aliasIn(plain, "apps/worker")).toEqual({});
    expect(aliasIn(plain, "apps/api")).toEqual({ "server-only": expect.stringContaining("node_modules/server-only/empty.js") });
    expect(aliasIn(plain, "packages/db")).toEqual({ "server-only": `${plain}/${EMPTY}` });
  });
});
