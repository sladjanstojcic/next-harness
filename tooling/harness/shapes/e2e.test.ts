import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { auditChanged } from "../core/audit/audit.ts";
import { checkPath, resolveHarness } from "../core/path-check.ts";
import { makeRepo } from "../testing/temp-repo.ts";

const E2E = "apps/e2e";
const config = (workspace: string): string =>
  `export default { workspaces: [{ path: "apps/web", shape: "makerkit-app", next: true }, ${workspace}], root: { entries: ["apps"] } };\n`;
const repo = (workspace = `{ path: "${E2E}", shape: "e2e" }`) =>
  makeRepo({ "harness.config.ts": config(workspace), "apps/web/package.json": "{}\n", [`${E2E}/package.json`]: "{}\n" });

describe("e2e shape", () => {
  const harness = resolveHarness(repo().root);
  const verdict = (file: string) => checkPath(`${E2E}/${file}`, harness);

  it.each([
    "package.json",
    "playwright.config.ts",
    "tsconfig.json",
    "README.md",
    "README-access-api.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    ".env",
    ".env.test",
    ".env.test.local",
    "tests/healthcheck.spec.ts",
    "tests/auth.setup.ts",
    "tests/.gitkeep",
    "tests/account/account.spec.ts",
    "tests/account/account.po.ts",
    "tests/account/avatar.png",
    "tests/access-api/matrix.spec.ts",
    "tests/access-api/clients.ts",
    "tests/access-api/matrix/snapshot.ts",
    "tests/access-api/matrix/calls/closed-columns.ts",
    "tests/access-api/lifecycles/support/lifecycle.ts",
  ])("accepts %s", (file) => {
    expect(verdict(file)).toEqual({ ok: true });
  });

  it.each([
    ["src/index.ts", "unknown-root", "An e2e workspace takes package.json, playwright.config.ts, tsconfig.json and tests/ at its top"],
    ["helpers.ts", "unknown-root", "put test code in tests/<suite>/"],
    ["tests/clients.ts", "module-shape", "Only <name>.spec.ts and <name>.setup.ts sit directly in tests/"],
    ["tests/access-api/matrix/calls/tables/specs.ts", "nesting", "at most two levels of area folders"],
    ["tests/utils/mailbox.ts", "generic-folder", "Name the tests/ subfolder after what it tests or holds"],
    ["tests/access-api/helpers/rows.ts", "generic-folder", "Name the tests/ subfolder after what it tests or holds"],
    ["tests/AccessApi/matrix.spec.ts", "file-name", "Use kebab-case names in tests/"],
    ["tests/access-api/matrixSnapshot.ts", "file-name", "Use kebab-case names in tests/"],
    ["tests/access-api/matrix.model.facts.ts", "file-name", "one optional role before the extension"],
    ["tests/account/Avatar.png", "file-name", "Use kebab-case names in tests/"],
    ["tests/account/.cache.json", "hidden-file", "only .gitkeep may be hidden"],
  ])("denies %s as %s", (file, rule, reason) => {
    const result = verdict(file);
    expect(result).toMatchObject({ ok: false, rule });
    expect(result.ok ? "" : result.reason).toContain(reason);
    expect(result.ok ? "" : result.reason).toContain("(e2e layout)");
  });

  it("denies a JavaScript test file with the core's rule", () => {
    expect(verdict("tests/account/account.spec.js")).toMatchObject({ ok: false, rule: "js-file" });
  });

  it("runs the oxc tools by default, takes none, and refuses ESLint and a Next flag", () => {
    expect(resolveHarness(repo().root).workspaces.find((workspace) => workspace.path === E2E)).toMatchObject({ shape: "e2e", tools: "oxc", next: false });
    expect(loadConfig(repo(`{ path: "${E2E}", shape: "e2e", tools: "none" }`).root).workspaces).toHaveLength(2);
    expect(() => loadConfig(repo(`{ path: "${E2E}", shape: "e2e", tools: "eslint-prettier" }`).root)).toThrow('must be "oxc" or "none" for the e2e shape');
    expect(() => loadConfig(repo(`{ path: "${E2E}", shape: "e2e", next: true }`).root)).toThrow("must not be true for the e2e shape");
  });

  it("holds a suite to the folder limit, counting spec files, and to no lint-disable comments", () => {
    const specs = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`${E2E}/tests/checkout/step-${String(index)}.spec.ts`, "export {};\n"]));
    const silenced = `${E2E}/tests/account/account.spec.ts`;
    const files = { ...specs, [silenced]: "// eslint-disable-next-line no-console\nconsole.log(1);\n" };
    const audited = makeRepo({ "harness.config.ts": config(`{ path: "${E2E}", shape: "e2e" }`), "apps/web/package.json": "{}\n", ...files });
    const findings = auditChanged(audited.root, Object.keys(files));
    expect(findings.filter((finding) => finding.rule === "folder-size")).toHaveLength(11);
    expect(findings.find((finding) => finding.rule === "folder-size")?.message).toContain(
      `${E2E}/tests/checkout/ has 11 source files (maximum 10). Group the files in a folder named after what they test, or split the suite in two (e2e layout).`,
    );
    expect(findings.filter((finding) => finding.rule === "inline-disable")).toEqual([
      {
        rule: "inline-disable",
        file: silenced,
        line: 1,
        message: "Remove the eslint-disable-next-line comment and fix the code it silences; test code may not turn off lint rules or type checks (e2e layout).",
      },
    ]);
  });
});
