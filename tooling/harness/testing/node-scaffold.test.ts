import { describe, expect, it } from "vitest";
import { initHarness } from "../core/init/init.ts";
import { consumerRepo } from "./template-repo.ts";

const CONFIG = 'export default {\n  workspaces: [{ path: "apps/api", shape: "node-service" }],\n  root: { entries: ["apps"] },\n};\n';
/** A service folder as `pnpm init` and a first tsconfig leave it: a package.json without "type" and a strict tsconfig. */
const FRESH = {
  "package.json": '{\n  "name": "repo",\n  "private": true\n}\n',
  "apps/api/package.json": '{\n  "name": "@acme/api",\n  "version": "0.0.0",\n  "private": true\n}\n',
  "apps/api/tsconfig.json": '{\n  "compilerOptions": { "strict": true },\n  "include": ["src"]\n}\n',
  "apps/api/src/main.ts": "export const port = 3000;\n",
  "harness.config.ts": CONFIG,
};
/** The same folder with both hand steps done. */
const DONE = {
  ...FRESH,
  "apps/api/package.json": '{\n  "name": "@acme/api",\n  "private": true,\n  "type": "module",\n  "imports": { "#/*": "./src/*" }\n}\n',
  "apps/api/tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "nodenext", noEmit: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true },
    include: ["src"],
  }),
};

const MODULE_LINE =
  'Make Node load src/ as ES modules and resolve #/ to it (init does not edit apps/api/package.json): add "type": "module" and "imports": {"#/*":"./src/*"}';
const OPTIONS_LINE =
  'Set the compiler options Node runs TypeScript with (init does not edit them in apps/api/tsconfig.json): "module": "nodenext", "noEmit": true, "erasableSyntaxOnly": true, "verbatimModuleSyntax": true';

describe("init in a node-service folder", () => {
  it("writes the service's configs and prints its two hand steps", () => {
    const repo = consumerRepo(FRESH);
    const { report, ok } = initHarness(repo.root, { force: false, starter: true });
    expect(ok, report).toBe(true);
    expect(repo.read("apps/api/eslint.config.ts")).toContain('layout: "service"');
    expect(repo.read("apps/api/knip.config.ts")).toContain("harnessKnipNode()");
    expect(repo.read("apps/api/.dependency-cruiser.json")).toContain("dependency-cruiser-node.json");
    expect(repo.read("apps/api/vitest.config.ts")).toContain("export default harnessVitest({ integration: false });");
    expect(repo.read("apps/api/.gitignore")).toBe("*.tsbuildinfo\n");
    expect(JSON.parse(repo.read("apps/api/tsconfig.json"))).toMatchObject({ compilerOptions: { allowImportingTsExtensions: true } });
    const scripts = (JSON.parse(repo.read("apps/api/package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.jscpd).toBe("jscpd src --config ../../tooling/harness/presets/jscpd.json --output node_modules/.cache/jscpd");
    expect(report).toContain("apps/api/src: --starter writes nothing here: the node-service shape has no starter files");
    const lines = report.split("\n");
    expect(lines.filter((line) => line.endsWith(MODULE_LINE))).toHaveLength(1);
    expect(lines.filter((line) => line.endsWith(OPTIONS_LINE))).toHaveLength(1);
  });

  it("prints neither hand step once both are done", () => {
    const { report, ok } = initHarness(consumerRepo(DONE).root, { force: false, starter: false });
    expect(ok, report).toBe(true);
    expect(report).not.toContain("Make Node load src/");
    expect(report).not.toContain("Set the compiler options Node runs");
  });
});
