import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { initHarness } from "./init.ts";

const OFF = { force: false, starter: false };
const LEGACY = "tooling/harness-legacy.json";
const config = (workspace: string, legacy = false): string =>
  `export default {\n  workspaces: [{ path: "apps/dashboard", shape: "next-modules", next: true${workspace} }],\n  root: { entries: ["apps"] },${legacy ? `\n  legacy: "${LEGACY}",` : ""}\n};\n`;

/** The dashboard's own ESLint config: Next's configs, which bring the TypeScript plugin, in a JavaScript file. */
const OWN_ESLINT = 'import nextTs from "eslint-config-next/typescript";\nexport default [...nextTs];\n';

function dashboard(files: Record<string, string>, installed: Record<string, string> = {}, workspace = "") {
  const modules = Object.entries(installed).map(([name, version]): [string, string] => [
    `apps/dashboard/node_modules/${name}/package.json`,
    JSON.stringify({ version }),
  ]);
  const repo = makeRepo({
    "harness.config.ts": config(workspace),
    ".gitignore": "node_modules/\n",
    "package.json": '{\n  "name": "monorepo"\n}\n',
    "apps/dashboard/package.json": '{\n  "scripts": { "test": "node --test tests/*.test.mjs" }\n}\n',
    "apps/dashboard/tsconfig.json": '{\n  "compilerOptions": { "allowJs": true },\n  "include": ["**/*.ts", "**/*.tsx"]\n}\n',
    ...Object.fromEntries<string>(modules),
    ...files,
  });
  repo.git("config", "--unset", "core.hooksPath");
  return repo;
}

const exists = (root: string, file: string): boolean => fs.existsSync(path.join(root, file));
const nextSteps = (report: string): string[] => report.split("\n").slice(report.split("\n").indexOf("Next steps, in this order:") + 1);
const installLine = (report: string): string => nextSteps(report).find((line) => line.includes("Install the harness's tools")) ?? "";

describe("init in an existing app", () => {
  it("keeps a Prettier config in any form without advice or a format step", () => {
    const forms: Record<string, string>[] = [
      { "apps/dashboard/.prettierrc": '{ "semi": false }\n' },
      { "apps/dashboard/prettier.config.mjs": "export default { semi: false };\n" },
      { "apps/dashboard/package.json": '{\n  "prettier": { "semi": false }\n}\n' },
    ];
    for (const form of forms) {
      const [file = ""] = Object.keys(form);
      const repo = dashboard(form);
      const { report, ok } = initHarness(repo.root, OFF);
      expect(ok, report).toBe(true);
      expect(report).toContain(`kept ${file}: your config stays as it is\n`);
      expect(report).not.toContain("harnessPrettier");
      expect(report).not.toContain("Format the app's own files");
      expect(exists(repo.root, "apps/dashboard/prettier.config.ts")).toBe(false);
      expect(nextSteps(report).find((line) => line.includes("Make the change each kept file"))).toBeUndefined();
    }
    const preset = initHarness(dashboard({}).root, OFF).report;
    expect(preset).toContain("created apps/dashboard/prettier.config.ts: harness preset");
    expect(preset).toContain("Format the app's own files once in the preset's style: (cd apps/dashboard && pnpm exec prettier --write .)");
  });

  it("writes no Vitest config beside a test script that does not run Vitest, and prints the config line that runs it", () => {
    const repo = dashboard({});
    const { report } = initHarness(repo.root, OFF);
    expect(exists(repo.root, "apps/dashboard/vitest.config.ts")).toBe(false);
    expect(report).toContain('kept apps/dashboard/package.json: its "test" script does not run Vitest; no Vitest config is written (see the next steps)');
    expect(nextSteps(report)).toContainEqual(
      expect.stringContaining(
        'Run this workspace\'s own tests in the gates instead of Vitest, by adding this to the "apps/dashboard" workspace in harness.config.ts: test: "test"',
      ),
    );
    expect(installLine(report)).not.toMatch(/vitest@|@types\/node@/);

    const set = dashboard({}, {}, ', test: "test"');
    const configured = initHarness(set.root, OFF).report;
    expect(configured).toContain('unchanged apps/dashboard/package.json: the gates run its "test" script; no Vitest config is written');
    expect(configured).not.toContain("add test:");

    const vitest = dashboard({ "apps/dashboard/package.json": '{\n  "scripts": { "test": "vitest run" }\n}\n' });
    const kept = initHarness(vitest.root, OFF).report;
    expect(exists(vitest.root, "apps/dashboard/vitest.config.ts")).toBe(true);
    expect(installLine(kept)).toMatch(/vitest@5\.1\.0/);
  });

  it("asks only for tools that are missing or below the minimum, never for a downgrade or a tool the workspace does not use", () => {
    const own = { "apps/dashboard/eslint.config.mjs": OWN_ESLINT, "apps/dashboard/.prettierrc": "{}\n" };
    const newer = dashboard(own, { eslint: "10.14.0", "eslint-config-next": "16.3.4", prettier: "3.9.6" });
    expect(installLine(initHarness(newer.root, OFF).report)).toBe(
      "  1. Install the harness's tools (init does not install): (cd apps/dashboard && pnpm add -D dependency-cruiser@18.7.2 eslint-config-prettier@10.1.8 eslint-plugin-react-hooks@7.1.1 jscpd@5.4.2 knip@6.44.1 typescript-eslint@8.72.1)",
    );
    const old = dashboard(own, { eslint: "9.21.0", "eslint-config-prettier": "10.1.8", "typescript-eslint": "8.72.1", prettier: "3.9.6" });
    const line = installLine(initHarness(old.root, OFF).report);
    expect(line).toContain(" eslint@9.39.5");
    expect(line).not.toMatch(/eslint-config-prettier@|typescript-eslint@|prettier@|@eslint\/js@|jiti@|@playwright\/test@/);
    const thin = dashboard({}, { eslint: "10.14.0" });
    expect(installLine(initHarness(thin.root, OFF).report)).toMatch(/@eslint\/js@9\.39\.5 .*eslint-config-next@16\.4\.5 .*jiti@2\.7\.0/);
  });

  it("leaves every config that imports a preset out of the workspace's tsconfig.json, a kept one included", () => {
    const repo = dashboard({ "apps/dashboard/eslint.config.mjs": OWN_ESLINT, "apps/dashboard/.prettierrc": "{}\n" });
    const { report } = initHarness(repo.root, OFF);
    expect(report).toContain(
      'updated apps/dashboard/tsconfig.json: compilerOptions.allowImportingTsExtensions: true, compilerOptions.paths "@/*": ["./src/*"], exclude eslint.config.mjs, knip.config.ts',
    );
    expect(JSON.parse(repo.read("apps/dashboard/tsconfig.json"))).toEqual({
      compilerOptions: { allowJs: true, allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] } },
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["node_modules", "eslint.config.mjs", "knip.config.ts"],
    });
    expect(initHarness(repo.root, OFF).report).toContain("unchanged apps/dashboard/tsconfig.json: ");
  });

  it("prints the legacy init step while the configured list is not written, and a full-history checkout for CI", () => {
    const repo = dashboard({ "harness.config.ts": config("", true) });
    const step = `node tooling/harness/cli.ts legacy init`;
    const first = initHarness(repo.root, OFF).report;
    expect(nextSteps(first).some((line) => line.endsWith(step))).toBe(true);
    expect(first).toContain("      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n      - uses: actions/setup-node@v7");
    expect(initHarness(dashboard({}).root, OFF).report).toContain("      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v7");
    repo.write(LEGACY, '{ "version": 1, "files": [] }\n');
    expect(initHarness(repo.root, OFF).report).not.toContain(step);
    expect(initHarness(dashboard({}).root, OFF).report).not.toContain(step);
  });
});
