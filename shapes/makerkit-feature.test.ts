import { describe, expect, it } from "vitest";
import { auditChanged } from "../core/audit/audit.ts";
import { codeIndex } from "../core/code-index.ts";
import { parseEvent, type HookEvent } from "../core/hooks/event.ts";
import { checkGuards } from "../core/hooks/guards.ts";
import { checkPath, resolveHarness } from "../core/path-check.ts";
import { makerkitRepo } from "../testing/makerkit-repo.ts";

const PKG = "packages/features/journal";
const KIT = "packages/features/accounts";

const writeEvent = (root: string, file: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "" } }, root);

const rulesOf = (root: string, files: string[]): string[] => auditChanged(root, files).map(({ file, rule }) => `${file} ${rule}`);

describe("makerkit-feature paths", () => {
  it.each([
    "package.json",
    "tsconfig.json",
    "AGENTS.md",
    "vitest.config.ts",
    "src/types.ts",
    "src/shared.ts",
    "src/components/index.ts",
    "src/components/journal-table.tsx",
    "src/components/entries/entry-row.tsx",
    "src/components/settings/email/update-email-form.tsx",
    "src/hooks/index.ts",
    "src/hooks/use-journal.ts",
    "src/hooks/use-journal.test.ts",
    "src/schema/journal-entry.schema.ts",
    "src/server/api.ts",
    "src/server/journal-server-actions.ts",
    "src/server/notifications.service.ts",
    "src/server/actions/create-entry-server-actions.ts",
    "src/server/services/journal.service.ts",
    "src/server/services/invitation-signature.ts",
    "src/server/services/webhooks/index.ts",
    "src/server/policies/index.ts",
    "src/server/policies/journal-policies.ts",
    "src/server/orchestration/assert-account-owner.ts",
    "src/shared/index.ts",
    "src/shared/balance.ts",
    "src/shared/balance.test.ts",
    "src/shared/queries/journal-entry.ts",
  ])("accepts the kit-shaped path %s", (file) => {
    const repo = makerkitRepo();
    expect(checkPath(`${PKG}/${file}`, resolveHarness(repo.root))).toEqual({ ok: true });
  });

  it.each([
    ["src/utils/x.ts", "generic-folder"],
    ["src/server/helpers/x.ts", "generic-folder"],
    ["src/server/actions/sub/x-server-actions.ts", "nesting"],
    ["src/server/actions/create-entry.ts", "file-name"],
    ["src/server/loaders/x.ts", "nesting"],
    ["src/server/x.ts", "file-name"],
    ["src/hooks/journal.ts", "file-name"],
    ["src/hooks/entries/use-entry.ts", "nesting"],
    ["src/schema/journal.ts", "file-name"],
    ["src/shared/a/b/x.ts", "nesting"],
    ["src/shared/x.tsx", "file-name"],
    ["src/components/a/b/c/x.tsx", "nesting"],
    ["src/components/JournalTable.tsx", "file-name"],
    ["src/index.ts", "file-name"],
    ["src/.secret.ts", "hidden-file"],
  ])("denies %s in an owned package with %s and a Makerkit location", (file, rule) => {
    const repo = makerkitRepo();
    const verdict = checkPath(`${PKG}/${file}`, resolveHarness(repo.root));
    expect(verdict).toMatchObject({ ok: false, rule });
    if (!verdict.ok) expect(verdict.reason).toContain("(Makerkit layout)");
    const denial = checkGuards(writeEvent(repo.root, `${PKG}/${file}`), repo.root);
    expect(denial?.guard).toBe("structure-write");
  });

  it("leaves the same violations in a kit package alone", () => {
    const files = [`${KIT}/src/utils/x.ts`, `${KIT}/src/server/helpers/x.ts`, `${KIT}/src/shared/balance.ts`];
    const repo = makerkitRepo(Object.fromEntries(files.map((file) => [file, "export const x = 1;\n"])));
    expect(auditChanged(repo.root, files)).toEqual([]);
    for (const file of files) expect(checkGuards(writeEvent(repo.root, file), repo.root)).toBeNull();
  });
});

describe("makerkit-feature content", () => {
  const chain = 'import { authActionClient } from "@kit/next/safe-action";\nexport const save = authActionClient.inputSchema(S).action(async () => {});\n';

  it.each([`${PKG}/src/server/actions/create-entry-server-actions.ts`, `${PKG}/src/server/journal-server-actions.ts`])(
    "accepts an owned Server Action file %s built with a kit action client",
    (action) => {
      const repo = makerkitRepo({ [action]: `"use server";\n${chain}` });
      expect(rulesOf(repo.root, [action])).toEqual([]);
    },
  );

  it("requires use server first in an owned action file", () => {
    const action = `${PKG}/src/server/actions/create-entry-server-actions.ts`;
    const repo = makerkitRepo({ [action]: chain });
    expect(rulesOf(repo.root, [action])).toEqual([`${action} use-server-placement`]);
  });

  it("requires server-only in owned server files except api.ts and index.ts", () => {
    const service = `${PKG}/src/server/services/journal.service.ts`;
    const api = `${PKG}/src/server/api.ts`;
    const barrel = `${PKG}/src/server/policies/index.ts`;
    const repo = makerkitRepo({ [service]: "export const a = 1;\n", [api]: "export const b = 1;\n", [barrel]: 'export { c } from "./c";\n' });
    expect(rulesOf(repo.root, [service, api, barrel])).toEqual([`${service} server-only`]);
  });

  it("requires a colocated test for owned src/shared/ code but not for index.ts or types.ts", () => {
    const files = [`${PKG}/src/shared/balance.ts`, `${PKG}/src/shared/index.ts`, `${PKG}/src/shared/types.ts`];
    const repo = makerkitRepo(Object.fromEntries(files.map((file) => [file, "export const x = 1;\n"])));
    const findings = auditChanged(repo.root, files);
    expect(findings.map(({ file, rule }) => `${file} ${rule}`)).toEqual([`${PKG}/src/shared/balance.ts domain-test`]);
    expect(findings[0]?.message).toContain(`${PKG}/src/shared/balance.test.ts`);
  });

  it("lets a client component import a Server Action file but not other server code", () => {
    const form = `${PKG}/src/components/entries/entry-form.tsx`;
    const repo = makerkitRepo({
      [form]:
        '"use client";\nimport { save } from "../../server/actions/create-entry-server-actions";\nimport { remove } from "../../server/journal-server-actions";\nimport { load } from "../../server/services/journal.service";\nexport const F = () => [save, remove, load];\n',
    });
    expect(auditChanged(repo.root, [form])).toEqual([expect.objectContaining({ rule: "client-imports-server", line: 4 })]);
  });

  it("flags use client outside components/ and hooks/, and process.env anywhere but NEXT_PUBLIC_* reads", () => {
    const shared = `${PKG}/src/shared/view.ts`;
    const repo = makerkitRepo({
      [shared]: '"use client";\nexport const url = process.env.NEXT_PUBLIC_SITE_URL;\nexport const sender = process.env.EMAIL_SENDER;\n',
      [`${PKG}/src/shared/view.test.ts`]: "",
    });
    expect(rulesOf(repo.root, [shared])).toEqual([`${shared} use-client-placement`, `${shared} env-access`]);
  });
});

describe("makerkit-feature code index", () => {
  it("lists package.json exports with each target's exports and expands * patterns", () => {
    const index = codeIndex(makerkitRepo().root);
    expect(index).toContain(`# ${KIT}`);
    expect(index).toContain("- `./api` → `src/server/api.ts`: `createAccountsApi`");
    expect(index).toContain("- `./hooks/*` → `src/hooks/use-update-account.ts`: `useUpdateAccount`");
    expect(index).toContain("- `./hooks/*` → `src/hooks/use-user-workspace.ts`: `useUserWorkspace`");
  });

  it("lists only files under a * target without an extension, also at the package root", () => {
    const repo = makerkitRepo({
      [`${PKG}/package.json`]: `${JSON.stringify({ exports: { "./components/*": "./src/components/*", "./*": "./*.ts" } })}\n`,
      [`${PKG}/src/components/journal-table.tsx`]: "export const JournalTable = () => null;\n",
      [`${PKG}/src/components/entries/entry-row.tsx`]: "export const EntryRow = () => null;\n",
      [`${PKG}/vitest.config.ts`]: "export const config = {};\n",
    });
    const index = codeIndex(repo.root);
    expect(index).toContain("- `./components/*` → `src/components/journal-table.tsx`: `JournalTable`");
    expect(index).not.toContain("entry-row");
    expect(index).toContain("- `./*` → `vitest.config.ts`: `config`");
  });

  it("follows relative export * barrels one level", () => {
    const repo = makerkitRepo({
      [`${PKG}/package.json`]: `${JSON.stringify({ exports: { "./shared": "./src/shared/index.ts" } })}\n`,
      [`${PKG}/src/shared/index.ts`]:
        'export * from "./keys";\nexport * from "./queries";\nexport * from "./types.ts";\nexport * as schemas from "./schemas";\nexport * from "@kit/shared";\n',
      [`${PKG}/src/shared/keys.ts`]: 'export const journalKeys = {};\nexport * from "./deeper";\n',
      [`${PKG}/src/shared/deeper.ts`]: "export const hidden = 1;\n",
      [`${PKG}/src/shared/queries/index.ts`]: "export function fetchEntries() {}\n",
      [`${PKG}/src/shared/types.ts`]: "export type Entry = { id: string };\n",
    });
    expect(codeIndex(repo.root)).toContain("- `./shared` → `src/shared/index.ts`: `journalKeys`, `fetchEntries`, `Entry`, `schemas`");
  });

  it("lists src/server/api.ts when no export points at it", () => {
    const repo = makerkitRepo({ [`${PKG}/src/server/api.ts`]: "export function createJournalApi() { return {}; }\n" });
    expect(codeIndex(repo.root)).toContain("- `src/server/api.ts`: `createJournalApi`");
  });
});
