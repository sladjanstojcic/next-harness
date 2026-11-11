import { describe, expect, it } from "vitest";
import { HARNESS_RULES, splitLegacy } from "../classes.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { audit } from "./audit.ts";
import { auditPreloadBundles, preloadBundleProblems } from "./preload-bundle.ts";

const config = (sections: string, imports = "defineConfig"): string =>
  `import { ${imports} } from "electron-vite";\n\nexport default defineConfig({\n  main: {},\n${sections}\n  renderer: {},\n});\n`;
const lines = (source: string): string[] => preloadBundleProblems(source).map(({ line, message }) => `${String(line)} ${message.split(/[ :]/)[0] ?? ""}`);

describe("preload-bundle, what the config says", () => {
  it.each([
    "  preload: { build: { externalizeDeps: false } },",
    '  "preload": { "build": { "externalizeDeps": false }, plugins: [swc()] },',
    "  preload: { resolve: { alias }, build: { sourcemap: true, externalizeDeps: false } },",
    "  preload: { ...base, build: { ...shared, externalizeDeps: false } },",
    "  preload: ({ build: { externalizeDeps: false } } satisfies Section),",
  ])("passes %s", (sections) => {
    expect(preloadBundleProblems(config(sections))).toEqual([]);
  });

  it("passes a plain exported object, and a config that builds no preload script", () => {
    expect(preloadBundleProblems("export default { main: {}, preload: { build: { externalizeDeps: false } } };\n")).toEqual([]);
    expect(preloadBundleProblems("export default { main: {}, renderer: {} };\n")).toEqual([]);
  });

  it.each([
    "  preload: {},",
    "  preload: { build: {} },",
    "  preload: { build: { externalizeDeps: true } },",
    "  preload: { build: { externalizeDeps: { exclude: ['zod'] } } },",
    "  preload: { build: { externalizeDeps: bundled } },",
    "  preload: { resolve: { alias } },",
  ])("reports %s, with why and the line to add", (sections) => {
    const [problem, ...rest] = preloadBundleProblems(config(sections));
    expect(rest).toEqual([]);
    expect(problem?.line).toBe(5);
    expect(problem?.message).toBe(
      'The preload section does not set build.externalizeDeps to false. A sandboxed preload script cannot load a package, and electron-vite leaves every package in "dependencies" outside the bundle, so the window gets no bridge. Add to the preload section: build: { externalizeDeps: false } (Electron layout)',
    );
  });

  it("reports externalizeDepsPlugin in the preload section's plugins, beside the setting or without it", () => {
    const imports = "defineConfig, externalizeDepsPlugin";
    const withSetting = config("  preload: {\n    build: { externalizeDeps: false },\n    plugins: [externalizeDepsPlugin()],\n  },", imports);
    expect(lines(withSetting)).toEqual(["7 externalizeDepsPlugin()"]);
    expect(preloadBundleProblems(withSetting)[0]?.message).toContain("Remove it from the preload section");
    expect(lines(config("  preload: { plugins: [swc(), externalizeDepsPlugin({ exclude: ['zod'] })] },", imports))).toEqual([
      "5 externalizeDepsPlugin()",
      "5 The",
    ]);
    expect(lines(config("  main: { plugins: [externalizeDepsPlugin()] },\n  preload: { build: { externalizeDeps: false } },", imports))).toEqual([]);
  });

  it.each([
    ["export default defineConfig(() => ({ preload: {} }));\n", "the exported config"],
    ["const config = { preload: {} };\n\nexport default config;\n", "the exported config"],
    ["export const preload = {};\n", "the exported config"],
    [config("  preload,"), "the preload section"],
    [config("  preload: section(),"), "the preload section"],
    [config("  ...sections,"), "the preload section"],
    [config("  preload: { ...base },"), "build in the preload section"],
    [config("  preload: { build },"), "build in the preload section"],
    [config("  preload: { build: buildOptions },"), "build in the preload section"],
    [config("  preload: { build: { ...shared } },"), "build.externalizeDeps in the preload section"],
    [config("  preload: { build: { externalizeDeps: false, ...shared } },"), "build.externalizeDeps in the preload section"],
  ])("says it could not see the setting in %j", (source, what) => {
    const [problem, ...rest] = preloadBundleProblems(source);
    expect(rest).toEqual([]);
    expect(problem?.message).toBe(
      `The rule could not see the setting: ${what} is not written out as an object literal. Write it literally, as preload: { build: { externalizeDeps: false } }, because a sandboxed preload script cannot load a package and electron-vite leaves every package in "dependencies" outside the bundle (Electron layout)`,
    );
  });
});

describe("preload-bundle, in the audit", () => {
  const ELECTRON = 'export default {\n  workspaces: [{ path: "apps/desk", shape: "electron-vite" }, { path: "apps/web", shape: "next-modules" }],\n';
  const files = { "apps/desk/electron.vite.config.ts": config("  preload: {},"), "apps/web/electron.vite.config.ts": config("  preload: {},") };

  it("is a harness rule, found by the full audit on the config of each electron-vite workspace", () => {
    expect(HARNESS_RULES.has("preload-bundle")).toBe(true);
    const { root } = makeRepo({ ...files, "harness.config.ts": `${ELECTRON}};\n` });
    expect(auditPreloadBundles(root).map(({ rule, file, line }) => `${file}:${String(line)} ${rule}`)).toEqual([
      "apps/desk/electron.vite.config.ts:5 preload-bundle",
    ]);
    expect(audit(root).filter(({ rule }) => rule === "preload-bundle")).toHaveLength(1);
  });

  it("has no finding without a config file, and is pre-existing for a config on the legacy list", () => {
    const empty = makeRepo({ "apps/desk/package.json": "{}\n", "harness.config.ts": `${ELECTRON}};\n` });
    expect(auditPreloadBundles(empty.root)).toEqual([]);
    const legacy = '{ "version": 1, "files": ["apps/desk/electron.vite.config.ts"] }\n';
    const listed = makeRepo({
      ...files,
      "tooling/harness-legacy.json": legacy,
      "harness.config.ts": `${ELECTRON}  legacy: "tooling/harness-legacy.json",\n};\n`,
    });
    const { blocking, preExisting } = splitLegacy(listed.root, auditPreloadBundles(listed.root));
    expect(blocking).toEqual([]);
    expect(preExisting.map(({ rule }) => rule)).toEqual(["preload-bundle"]);
  });
});
