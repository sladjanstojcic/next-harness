import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type HarnessConfig } from "../config.ts";
import { makeRepo } from "../testing/temp-repo.ts";
import { auditContent } from "./audit/content-rules.ts";
import { codeIndex } from "./code-index.ts";
import { nextModules } from "../shapes/next-modules.ts";
import type { Shape } from "../shapes/shape.ts";
import { checkPath, resolveHarness } from "./path-check.ts";
import { rootEntries } from "./root-layout.ts";

const TODAY_ROOT_ENTRIES = [
  "src",
  "tooling",
  "e2e",
  "scripts",
  "docs",
  "public",
  ".github",
  ".githooks",
  ".claude",
  ".codex",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "eslint.config.ts",
  "prettier.config.ts",
  "knip.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "components.json",
  ".dependency-cruiser.json",
  ".jscpd.json",
  ".gitignore",
  ".mcp.json",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".editorconfig",
  ".gitattributes",
  ".prettierignore",
  ".env.example",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "CHANGELOG.md",
];

describe("root layout", () => {
  it("merges with the next-modules top level into today's root entries", () => {
    expect(new Set([...rootEntries(DEFAULT_CONFIG).entries, ...nextModules.topEntries])).toEqual(new Set(TODAY_ROOT_ENTRIES));
  });

  it("accepts the legacy file at the root when the config names one", () => {
    expect(rootEntries({ ...DEFAULT_CONFIG, legacy: "harness-legacy.json" }).entries.has("harness-legacy.json")).toBe(true);
    expect(
      checkPath(
        "harness-legacy.json",
        resolveHarness(
          makeRepo({ "harness.config.ts": 'export default { workspaces: [{ path: ".", shape: "next-modules" }], legacy: "harness-legacy.json" };\n' }).root,
        ),
      ),
    ).toEqual({ ok: true });
    expect(checkPath("harness-legacy.json")).toEqual(expect.objectContaining({ rule: "unknown-root" }));
  });

  it("accepts harness.config.ts only when the file exists", () => {
    expect(rootEntries(DEFAULT_CONFIG).entries.has("harness.config.ts")).toBe(false);
    expect(
      resolveHarness(makeRepo({ "harness.config.ts": 'export default { workspaces: [{ path: ".", shape: "next-modules" }] };\n' }).root).root.entries.has(
        "harness.config.ts",
      ),
    ).toBe(true);
  });
});

describe("checkPath with a configured workspace", () => {
  const config: HarnessConfig = { workspaces: [{ path: "apps/web", shape: "next-modules" }], root: { entries: ["apps", "turbo.json"] } };
  const harness = resolveHarness(makeRepo({ "harness.config.ts": `export default ${JSON.stringify(config)};\n` }).root);

  it.each([
    ["apps/web/src/utils/x.ts", "src-shape"],
    ["src/x.ts", "unknown-root"],
    ["apps/web/tooling/x.ts", "unknown-root"],
    ["apps/web/src/modules/orders/components/OrderRow.tsx", "file-name"],
  ])("denies %s with %s", (file, rule) => {
    expect(checkPath(file, harness)).toMatchObject({ ok: false, rule });
  });

  it.each(["apps/web/src/modules/a/index.ts", "turbo.json", "docs/x.md", "apps/web/package.json", "harness.config.ts"])("allows %s", (file) => {
    expect(checkPath(file, harness)).toEqual({ ok: true });
  });

  it("reads the content profile against the workspace-relative path", () => {
    const file = "apps/web/src/modules/a/server/get.ts";
    const repo = makeRepo({ "harness.config.ts": `export default ${JSON.stringify(config)};\n`, [file]: "export const get = 1;\n" });
    expect(auditContent(repo.root, [file]).map((finding) => finding.rule)).toEqual(["server-only"]);
  });

  it("lists a configured workspace under its path", () => {
    const repo = makeRepo({ "harness.config.ts": `export default ${JSON.stringify(config)};\n`, "apps/web/src/shared/lib/format.ts": "export const f = 1;\n" });
    expect(codeIndex(repo.root)).toContain("\n\n# apps/web\n\n## shared/lib\n\n- `format.ts`: `f`\n");
  });
});

describe("a shape's JS exceptions", () => {
  it("allow the file inside that shape's workspace only", () => {
    const config: HarnessConfig = {
      workspaces: [
        { path: "apps/web", shape: "next-modules" },
        { path: "apps/api", shape: "next-modules" },
      ],
      root: { entries: ["apps"] },
    };
    const resolved = resolveHarness(makeRepo({ "harness.config.ts": `export default ${JSON.stringify(config)};\n` }).root);
    const withConfig = (jsExceptions: string[]): Shape => ({ ...nextModules, topEntries: [...nextModules.topEntries, "next.config.mjs"], jsExceptions });
    const harness = {
      ...resolved,
      workspaces: resolved.workspaces.map((workspace) => ({ ...workspace, shapeImpl: withConfig(workspace.path === "apps/web" ? ["next.config.mjs"] : []) })),
    };
    expect(checkPath("apps/web/next.config.mjs", harness)).toEqual({ ok: true });
    expect(checkPath("apps/api/next.config.mjs", harness)).toMatchObject({ ok: false, rule: "js-file" });
  });
});
