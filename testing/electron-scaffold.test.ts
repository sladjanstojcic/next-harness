import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { audit } from "../core/audit/audit.ts";
import { splitLegacy } from "../core/classes.ts";
import { ciGate } from "../core/gates/ci-gate.ts";
import { initLegacy } from "../core/legacy.ts";
import { checkPath, resolveHarness } from "../core/path-check.ts";
import { adoptedElectron, commitAll, ELECTRON_LEGACY, ELECTRON_LEGACY_CONFIG, SCAFFOLD } from "./electron-repo.ts";

const R = "src/renderer/src";
/**
 * What the generator wrote that the shape and the harness's rules do not take: the editor folder, the two components in
 * the old layout, the main and preload scripts (an open sandbox, a literal channel, console output, @ts-ignore, the
 * toolkit's preload helper), a non-null assertion, and the two projects whose base turns noImplicitAny off.
 */
const LEGACY_FILES = [
  ".vscode/extensions.json",
  ".vscode/launch.json",
  ".vscode/settings.json",
  "src/main/index.ts",
  "src/preload/index.d.ts",
  "src/preload/index.ts",
  `${R}/App.tsx`,
  `${R}/components/Versions.tsx`,
  `${R}/main.tsx`,
  "tsconfig.node.json",
  "tsconfig.web.json",
];

describe("the official electron-vite scaffold (react-ts), adopted with a legacy list", () => {
  it("is adopted by init, its misfits go on the legacy list, and the CI gate passes with them reported as pre-existing", async () => {
    const repo = adoptedElectron(SCAFFOLD, ELECTRON_LEGACY_CONFIG);
    expect(repo.report).toContain(
      [
        "kept eslint.config.mjs: your config stays; add the harness preset to it, the import at the top of the file, the spread as the last argument of the exported call:",
        '    import { harnessEslint } from "./tooling/harness/presets/eslint.ts";',
        '    ...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false, toolsFrom: "@electron-toolkit/eslint-config-ts" }),',
        "kept .prettierrc.yaml: your config stays as it is",
        "created vitest.config.ts: harness preset",
        "created knip.config.ts: harness preset",
        "created .dependency-cruiser.json: harness preset",
        "updated tsconfig.node.json: exclude tooling/harness, harness.config.ts, eslint.config.mjs, vitest.config.ts, knip.config.ts",
        "updated .gitignore: *.tsbuildinfo",
      ].join("\n"),
    );
    expect(repo.report).toContain("legacy init");
    expect(repo.read("tsconfig.web.json")).toBe(SCAFFOLD["tsconfig.web.json"]);
    // Files init wrote are in the project's own style, which its ESLint config holds Prettier to.
    expect(repo.read("knip.config.ts")).toContain("import { harnessKnipElectron } from './tooling/harness/presets/knip.ts'");

    const root = fs.realpathSync(repo.root);
    const written = await initLegacy(root, resolveHarness(root));
    expect(written).toBe(`Wrote ${ELECTRON_LEGACY} with ${String(LEGACY_FILES.length)} files. Commit it; until then legacy-append is inert.`);
    expect((JSON.parse(repo.read(ELECTRON_LEGACY)) as { files: string[] }).files).toEqual([...LEGACY_FILES].sort());
    commitAll(repo);

    const { blocking, preExisting } = splitLegacy(root, audit(root));
    expect(blocking).toEqual([]);
    expect(preExisting.map(({ rule, file, line }) => `${file}:${String(line ?? 1)} ${rule}`).sort()).toEqual(
      [
        ".vscode/extensions.json:1 unknown-root",
        ".vscode/launch.json:1 unknown-root",
        ".vscode/settings.json:1 unknown-root",
        "src/main/index.ts:16 electron-security",
        "src/main/index.ts:53 ipc-channel",
        `${R}/App.tsx:1 file-name`,
        `${R}/App.tsx:5 electron-bridge`,
        `${R}/App.tsx:5 ipc-channel`,
        `${R}/components/Versions.tsx:1 file-name`,
        "tsconfig.node.json:1 tsconfig-strict",
        "tsconfig.web.json:1 tsconfig-strict",
      ].sort(),
    );

    const result = await ciGate(fs.realpathSync(repo.root));
    const steps = result.report.split("\n").filter((line) => /^[a-z-]+: (?:passed|failed|skipped)/.test(line));
    expect(steps, result.report).toEqual(
      ["prettier", "eslint", "eslint-preset", "tsc", "audit", "depcruise", "knip", "jscpd", "vitest", "build"].map((step) => `${step}: passed`),
    );
    expect(result.passed).toBe(true);
    expect(result.report).toContain("Pre-existing in legacy files (not blocking):");
    // The generator's own lint and type debt, and the toolkit helper its preload script imports, are old debt too.
    for (const line of ["eslint: 11 findings in 4 files", "tsc: 1 finding in 1 file", "audit: 11 findings in 8 files", "depcruise: 2 findings in 2 files"]) {
      expect(result.report).toContain(line);
    }
    expect(result.report).toContain("A preload script is the bridge and nothing more: it imports electron and the contract in src/shared/ (Electron layout).");
    expect(repo.git("status", "--porcelain")).toBe("");
  }, 600_000);

  it("holds new code to the shape while the old files stay where the generator put them", () => {
    const repo = adoptedElectron(SCAFFOLD, ELECTRON_LEGACY_CONFIG);
    const harness = resolveHarness(repo.root);
    expect(checkPath(`${R}/components/Settings.tsx`, harness)).toMatchObject({ ok: false, rule: "file-name" });
    expect(checkPath(`${R}/components/settings.tsx`, harness)).toMatchObject({ ok: false, rule: "src-shape" });
    expect(checkPath(`${R}/modules/settings/components/settings-form.tsx`, harness)).toEqual({ ok: true });
    for (const file of [
      "src/preload/index.d.ts",
      `${R}/assets/wavy-lines.svg`,
      `${R}/assets/base.css`,
      "build/entitlements.mac.plist",
      ".editorconfig",
      ".prettierrc.yaml",
    ]) {
      expect(checkPath(file, harness), file).toEqual({ ok: true });
    }
  }, 120_000);
});
