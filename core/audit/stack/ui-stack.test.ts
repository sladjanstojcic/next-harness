import { afterEach, describe, expect, it, vi } from "vitest";
import { HARNESS_RULES } from "../../classes.ts";
import { ciGate } from "../../gates/ci-gate.ts";
import * as runner from "../../gates/run-tool.ts";
import { makeRepo } from "../../../testing/temp-repo.ts";
import { audit, auditChanged } from "../audit.ts";
import { auditUiStack } from "./ui-stack.ts";

afterEach(() => vi.restoreAllMocks());

const SITE = "https://sladjanstojcic.github.io/next-harness";
const SHADCN = { "components.json": '{ "style": "base-nova" }\n' };
const pkg = (fields: object): string => `${JSON.stringify({ name: "app", ...fields }, null, 2)}\n`;
const WITH_DEV = pkg({ devDependencies: { tailwindcss: "4.1.0" } });
const WITHOUT = pkg({ dependencies: { react: "19.0.0" }, devDependencies: { "tailwind-merge": "3.0.0" } });
const config = (shape: string, path = ".", extra = ""): string => `export default {\n  workspaces: [{ path: "${path}", shape: "${shape}" }],\n${extra}};\n`;

const noShadcn = (page: string, suffix: string): string =>
  `This app has no components.json: every app is built with TypeScript, Tailwind and shadcn. Set shadcn up with the steps on ${SITE}/${page}; they change locked tool configs, so the user unlocks first${suffix}`;

describe.each([
  ["next-modules", "next-app.html", "."],
  ["vite-spa", "vite.html", " (Vite layout)"],
  ["electron-vite", "electron.html", " (Electron layout)"],
])("ui-stack in a %s workspace", (shape, page, suffix) => {
  it.each([
    ["components.json and tailwindcss", true, WITH_DEV, false],
    ["components.json and no tailwindcss", true, WITHOUT, false],
    ["no components.json", false, WITH_DEV, true],
    ["neither", false, WITHOUT, true],
  ])("%s", (_name, shadcn, packageJson, reported) => {
    const repo = makeRepo({ "harness.config.ts": config(shape), "package.json": packageJson, ...(shadcn ? SHADCN : {}) });
    expect(auditUiStack(repo.root)).toEqual(reported ? [{ rule: "ui-stack", file: "package.json", message: noShadcn(page, suffix) }] : []);
  });
});

describe("ui-stack, which workspaces", () => {
  it("reports on the package.json of a workspace below the root, and reads components.json at its top", () => {
    const repo = makeRepo({ "harness.config.ts": config("next-modules", "apps/web"), "apps/web/package.json": WITH_DEV, "components.json": "{}\n" });
    expect(auditUiStack(repo.root).map(({ rule, file }) => `${file} ${rule}`)).toEqual(["apps/web/package.json ui-stack"]);
    repo.write("apps/web/components.json", "{}\n");
    expect(auditUiStack(repo.root)).toEqual([]);
  });

  it.each(["makerkit-app", "makerkit-feature", "package", "supabase", "e2e"])("does not judge a %s workspace", (shape) => {
    const repo = makeRepo({ "harness.config.ts": config(shape, "apps/one"), "apps/one/package.json": WITHOUT });
    expect(auditUiStack(repo.root)).toEqual([]);
  });

  it("has no finding for a workspace without a package.json", () => {
    expect(auditUiStack(makeRepo({ "harness.config.ts": config("vite-spa", "apps/spa"), "apps/spa/src/main.tsx": "" }).root)).toEqual([]);
  });

  it("is a harness rule in the full audit, not in the changed-files audit", () => {
    expect(HARNESS_RULES.has("ui-stack")).toBe(true);
    const repo = makeRepo({ "harness.config.ts": config("next-modules"), "package.json": WITHOUT });
    expect(audit(repo.root).filter(({ rule }) => rule === "ui-stack")).toHaveLength(1);
    expect(auditChanged(repo.root, ["package.json"]).filter(({ rule }) => rule === "ui-stack")).toEqual([]);
  });
});

describe("ui-stack in the CI gate", () => {
  const LEGACY = '  legacy: "tooling/harness-legacy.json",\n';

  it("fails an app without components.json, and passes it while its package.json is on the legacy list and unchanged", async () => {
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const bare = makeRepo({ "harness.config.ts": config("next-modules"), "package.json": WITHOUT, "e2e/smoke.test.ts": "" }, { agents: true });
    const failed = await ciGate(bare.root);
    expect(failed.passed).toBe(false);
    expect(failed.findings.map(({ file, rule }) => `${file} ${rule}`)).toEqual(["package.json ui-stack"]);

    const listed = makeRepo(
      {
        "harness.config.ts": config("next-modules", ".", LEGACY),
        "tooling/harness-legacy.json": '{ "version": 1, "files": ["package.json"] }\n',
        "package.json": WITHOUT,
        "e2e/smoke.test.ts": "",
      },
      { agents: true },
    );
    const passed = await ciGate(listed.root);
    expect(passed.findings).toEqual([]);
    expect(passed.passed).toBe(true);
    expect(passed.preExisting.map(({ rule }) => rule)).toEqual(["ui-stack"]);
  });
});
