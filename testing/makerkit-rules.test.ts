import { describe, expect, it } from "vitest";
import { audit, auditChanged } from "../core/audit/audit.ts";
import { parseEvent, type HookEvent } from "../core/hooks/event.ts";
import { checkGuards } from "../core/hooks/guards.ts";
import { MAKERKIT_KIT_ROUTE, MAKERKIT_ROUTE, makerkitRepo } from "./makerkit-repo.ts";
import { makeRepo } from "./temp-repo.ts";

const PKG = "packages/features/journal";
const KIT = "packages/features/accounts";
const OWNED_COMPONENT = `${PKG}/src/components/journal-table.tsx`;
const KIT_COMPONENT = `${KIT}/src/components/account-table.tsx`;

const writeEvent = (root: string, file: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "{}" } }, root);

const ruleLines = (root: string, files: string[], rule: string): string[] =>
  auditChanged(root, files)
    .filter((finding) => finding.rule === rule)
    .map(({ file, line }) => `${file}:${line ?? 0}`);

describe("inline-disable in the Makerkit shapes", () => {
  it.each([
    ["// eslint-disable-next-line no-console\nconsole.log(1);\n", 1],
    ["/* eslint-disable */\nexport const a = 1;\n", 1],
    ["export const a = 1; // eslint-disable-line\n", 1],
    ["/*eslint-disable no-console*/\nexport const a = 1;\n", 1],
    ["// oxlint-disable-next-line no-console\nconsole.log(1);\n", 1],
    ["/* oxlint-disable typescript/no-explicit-any */\nexport const a = 1;\n", 1],
    ["// @ts-ignore\nexport const a: number = 'x';\n", 1],
    ["// @ts-expect-error: wrong on purpose\nexport const a: number = 'x';\n", 1],
    ["// @ts-nocheck\nexport const a = 1;\n", 1],
    ["/**\n * Docs.\n * @ts-expect-error\n */\nexport const a: number = 'x';\n", 1],
    ["export function f() {\n  return 1;\n  // eslint-disable-next-line\n}\n", 3],
    ["export const a = 1;\n// oxlint-disable", 2],
    ["export const A = () => (\n  <div>\n    {/* eslint-disable-next-line */}\n    <span />\n  </div>\n);\n", 3],
    ["export const a = [\n  1, // eslint-disable-line\n  2,\n];\n", 2],
  ])("finds %j in an owned feature file", (text, line) => {
    const repo = makerkitRepo({ [OWNED_COMPONENT]: text });
    expect(ruleLines(repo.root, [OWNED_COMPONENT], "inline-disable")).toEqual([`${OWNED_COMPONENT}:${line}`]);
  });

  it.each([
    'export const a = "eslint-disable-next-line";\n',
    "export const a = `// @ts-ignore ${1}`;\n",
    "export const A = () => <p>// eslint-disable-next-line</p>;\n",
    "// @ts-check\nexport const a = 1;\n",
    "// eslint-enable\nexport const a = 1;\n",
  ])("leaves %j alone", (text) => {
    const repo = makerkitRepo({ [OWNED_COMPONENT]: text });
    expect(ruleLines(repo.root, [OWNED_COMPONENT], "inline-disable")).toEqual([]);
  });

  it("names the directive and covers owned routes, owned tests and every comment in a file", () => {
    const page = `${MAKERKIT_ROUTE}/_components/journal-list.tsx`;
    const test = `${PKG}/src/shared/balance.test.ts`;
    const repo = makerkitRepo({
      [page]: "// @ts-ignore\nexport const a = 1;\n// oxlint-disable-next-line\nexport const b = 2;\n",
      [test]: "// eslint-disable-next-line\nexport const c = 1;\n",
    });
    const findings = auditChanged(repo.root, [page, test]).filter((finding) => finding.rule === "inline-disable");
    expect(findings.map(({ file, line }) => `${file}:${line ?? 0}`)).toEqual([`${page}:1`, `${page}:3`, `${test}:1`]);
    expect(findings[0]?.message).toBe("Remove the @ts-ignore comment and fix the code it silences; owned code may not turn off lint rules or type checks.");
    expect(findings[1]?.message).toContain("oxlint-disable-next-line");
  });

  it("leaves kit files with the same comments alone", () => {
    const text = "// eslint-disable-next-line\n// @ts-ignore\n/* oxlint-disable */\nexport const a = 1;\n";
    const files = [KIT_COMPONENT, `${MAKERKIT_KIT_ROUTE}/_components/billing-form.tsx`];
    const repo = makerkitRepo(Object.fromEntries(files.map((file) => [file, text])));
    expect(auditChanged(repo.root, files)).toEqual([]);
    expect(audit(repo.root).filter((finding) => finding.rule === "inline-disable")).toEqual([]);
  });

  it("stays off without a config, where ESLint's noInlineConfig covers it", () => {
    const file = "src/modules/notes/components/note-list.tsx";
    const repo = makeRepo({ [file]: "// eslint-disable-next-line\n// @ts-ignore\nexport const a = 1;\n" });
    expect(auditChanged(repo.root, [file]).filter((finding) => finding.rule === "inline-disable")).toEqual([]);
  });
});

describe("package-boundary in the Makerkit shapes", () => {
  const SERVICE = `${PKG}/src/server/services/journal.service.ts`;
  const ROUTE_PAGE = `${MAKERKIT_ROUTE}/page.tsx`;
  const out = "../../../../accounts/src/server/api";
  const fromRoute = "../../../../../../../packages/features/accounts/src/server/api";

  it.each([
    [`import { createAccountsApi } from "${out}";\n`],
    [`import type { Api } from "${out}";\n`],
    [`export { createAccountsApi } from "${out}";\n`],
    [`export * from "${out}";\n`],
    [`export const load = () => import("${out}");\n`],
    [`const api = require("${out}");\nexport default api;\n`],
    [`import "../../../../accounts/package.json";\n`],
    [`import x from "../../../..";\nexport default x;\n`],
  ])("finds %j in an owned feature package", (text) => {
    const repo = makerkitRepo({ [SERVICE]: `import "server-only";\n${text}` });
    expect(ruleLines(repo.root, [SERVICE], "package-boundary")).toEqual([`${SERVICE}:2`]);
  });

  it("finds a relative import out of the app in an owned route and names the export to use", () => {
    const repo = makerkitRepo({ [ROUTE_PAGE]: `import { createAccountsApi } from "${fromRoute}";\nexport default function Page() {\n  return null;\n}\n` });
    const findings = auditChanged(repo.root, [ROUTE_PAGE]).filter((finding) => finding.rule === "package-boundary");
    expect(findings.map(({ file, line }) => `${file}:${line ?? 0}`)).toEqual([`${ROUTE_PAGE}:1`]);
    expect(findings[0]?.message).toContain("@kit/<name>/<export>");
  });

  it("allows package exports, aliases and relative paths that stay inside the package or app", () => {
    const repo = makerkitRepo({
      [SERVICE]:
        'import "server-only";\nimport { createAccountsApi } from "@kit/accounts/api";\nimport { JournalSchema } from "../../schema/journal.schema";\nexport { createAccountsApi, JournalSchema };\n',
      [`${PKG}/src/schema/journal.schema.ts`]: "export const JournalSchema = {};\n",
      [ROUTE_PAGE]:
        'import { pathsConfig } from "~/config/paths.config";\nimport { List } from "./_components/journal-list";\nimport { Layout } from "../../../layout";\nexport default function Page() {\n  return [pathsConfig, List, Layout];\n}\n',
    });
    expect(ruleLines(repo.root, [SERVICE, ROUTE_PAGE], "package-boundary")).toEqual([]);
  });

  it("leaves kit packages and kit routes with the same imports alone", () => {
    const kitService = `${KIT}/src/server/services/accounts.service.ts`;
    const kitPage = `${MAKERKIT_KIT_ROUTE}/page.tsx`;
    const repo = makerkitRepo({
      [kitService]: `import { x } from "../../../../journal/src/shared/balance";\nexport { x };\n`,
      [kitPage]: `import { x } from "${fromRoute}";\nexport default function Page() {\n  return x;\n}\n`,
    });
    expect(auditChanged(repo.root, [kitService, kitPage])).toEqual([]);
  });
});

describe("the project cannot switch the owned lint rules off", () => {
  it.each([`${PKG}/.oxlintrc.json`, `${PKG}/src/.oxlintrc.json`, `${MAKERKIT_ROUTE}/.oxlintrc.json`])("denies a nested oxlint config at %s", (file) => {
    const repo = makerkitRepo();
    expect(checkGuards(writeEvent(repo.root, file), repo.root)?.guard).toBe("nested-lint-config");
  });

  it("locks the harness's own oxlint config", () => {
    const repo = makerkitRepo();
    expect(checkGuards(writeEvent(repo.root, "tooling/harness/presets/oxlint-owned.json"), repo.root)?.guard).toBe("harness-lock");
  });
});
