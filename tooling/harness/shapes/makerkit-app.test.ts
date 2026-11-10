import { describe, expect, it } from "vitest";
import { auditChanged } from "../core/audit/audit.ts";
import { codeIndex } from "../core/code-index.ts";
import { parseEvent, type HookEvent } from "../core/hooks/event.ts";
import { checkGuards } from "../core/hooks/guards.ts";
import { checkPath, resolveHarness } from "../core/path-check.ts";
import { MAKERKIT_KIT_ROUTE, MAKERKIT_ROUTE, makerkitConfig, makerkitRepo } from "../testing/makerkit-repo.ts";

const writeEvent = (root: string, file: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "" } }, root);

const rulesOf = (root: string, files: string[]): string[] => auditChanged(root, files).map(({ file, rule }) => `${file} ${rule}`);

describe("makerkit-app paths", () => {
  it.each([
    `${MAKERKIT_ROUTE}/page.tsx`,
    `${MAKERKIT_ROUTE}/loading.tsx`,
    `${MAKERKIT_ROUTE}/_components/journal-table.tsx`,
    `${MAKERKIT_ROUTE}/_components/entries/entry-row.tsx`,
    `${MAKERKIT_ROUTE}/_lib/server/server-actions.ts`,
    `${MAKERKIT_ROUTE}/_lib/server/journal-page.loader.ts`,
    `${MAKERKIT_ROUTE}/_lib/schema/journal-entry.schema.ts`,
    `${MAKERKIT_ROUTE}/_lib/journal-page-path.ts`,
    `${MAKERKIT_ROUTE}/[entry]/page.tsx`,
    "apps/web/app/[locale]/(marketing)/(legal)/cookie-policy/page.tsx",
    "apps/web/app/[locale]/docs/[...slug]/page.tsx",
    "apps/web/app/[locale]/admin/AGENTS.md",
    "apps/web/app/api/healthcheck/route.ts",
    "apps/web/app/global-error.tsx",
    "apps/web/app/robots.ts",
    "apps/web/components/skeletons/page-skeletons.tsx",
    "apps/web/config/billing.sample.config.ts",
    "apps/web/config/team-account-navigation.config.tsx",
    "apps/web/lib/database.types.ts",
    "apps/web/lib/server/workspace/compose-team-workspace.ts",
    "apps/web/i18n/request.ts",
    "apps/web/i18n/messages/en/common.json",
    "apps/web/styles/globals.css",
    "apps/web/content/documentation/getting-started/installation.mdoc",
    "apps/web/public/images/favicon/android-chrome-192x192.png",
    "apps/web/next.config.mjs",
    "apps/web/postcss.config.mjs",
    "apps/web/.env.production",
    "apps/web/instrumentation-client.ts",
    "apps/web/supabase/config.toml",
  ])("accepts the kit-shaped path %s", (file) => {
    const repo = makerkitRepo();
    expect(checkPath(file, resolveHarness(repo.root))).toEqual({ ok: true });
  });

  it.each([
    [`${MAKERKIT_ROUTE}/helpers/x.ts`, "app-file"],
    [`${MAKERKIT_ROUTE}/_lib/utils/x.ts`, "nesting"],
    [`${MAKERKIT_ROUTE}/Foo.tsx`, "file-name"],
    [`${MAKERKIT_ROUTE}/_helpers/x.ts`, "app-file"],
    [`${MAKERKIT_ROUTE}/_components/utils/x.tsx`, "generic-folder"],
    [`${MAKERKIT_ROUTE}/_components/table/cells/x.tsx`, "nesting"],
    [`${MAKERKIT_ROUTE}/_lib/schema/journal.ts`, "file-name"],
    [`${MAKERKIT_ROUTE}/_lib/server/actions/server-actions.ts`, "nesting"],
    [`${MAKERKIT_ROUTE}/Entries/page.tsx`, "file-name"],
  ])("denies %s in an owned route with %s and a Makerkit location", (file, rule) => {
    const repo = makerkitRepo();
    const verdict = checkPath(file, resolveHarness(repo.root));
    expect(verdict).toMatchObject({ ok: false, rule });
    if (!verdict.ok) expect(verdict.reason).toContain("(Makerkit layout)");
    const denial = checkGuards(writeEvent(repo.root, file), repo.root);
    expect(denial?.guard).toBe("structure-write");
    expect(denial?.reason).toContain("(Makerkit layout)");
  });

  it.each([
    ["apps/web/config/app.ts", "file-name"],
    ["apps/web/styles/theme.ts", "file-name"],
    ["apps/web/components/a/b/x.tsx", "nesting"],
    ["apps/web/lib/helpers/x.ts", "generic-folder"],
    ["apps/web/i18n/messages/x.json", "file-name"],
    ["apps/web/content/x.mdoc", "nesting"],
    ["apps/web/lib/.secret.ts", "hidden-file"],
  ])("denies %s outside routes with %s", (file, rule) => {
    const repo = makerkitRepo();
    expect(checkPath(file, resolveHarness(repo.root))).toMatchObject({ ok: false, rule });
  });

  it("leaves the same violations in a kit route alone", () => {
    const files = [`${MAKERKIT_KIT_ROUTE}/helpers/x.ts`, `${MAKERKIT_KIT_ROUTE}/_lib/utils/x.ts`, `${MAKERKIT_KIT_ROUTE}/Foo.tsx`];
    const repo = makerkitRepo(Object.fromEntries(files.map((file) => [file, "export const x = 1;\n"])));
    expect(auditChanged(repo.root, files)).toEqual([]);
    for (const file of files) expect(checkGuards(writeEvent(repo.root, file), repo.root)).toBeNull();
  });

  it("names the shape's jsExceptions in a configured repository", () => {
    const repo = makerkitRepo();
    const verdict = checkPath("apps/web/lib/x.js", resolveHarness(repo.root));
    expect(verdict).toMatchObject({ ok: false, rule: "js-file" });
    if (!verdict.ok) expect(verdict.reason).toContain("shape's jsExceptions");
  });
});

describe("makerkit-app content", () => {
  const action = `${MAKERKIT_ROUTE}/_lib/server/server-actions.ts`;
  const chain = 'import { authActionClient } from "@kit/next/safe-action";\nexport const save = authActionClient.inputSchema(S).action(async () => {});\n';

  it("accepts an owned server action built with a kit action client", () => {
    const repo = makerkitRepo({ [action]: `"use server";\n${chain}` });
    expect(rulesOf(repo.root, [action])).toEqual([]);
  });

  it.each(["publicActionClient", "captchaActionClient", "adminActionClient"])("accepts an owned server action built with %s", (client) => {
    const repo = makerkitRepo({ [action]: `"use server";\n${chain.replaceAll("authActionClient", client)}` });
    expect(rulesOf(repo.root, [action])).toEqual([]);
    repo.write(action, chain.replaceAll("authActionClient", client));
    expect(rulesOf(repo.root, [action])).toEqual([`${action} use-server-placement`]);
  });

  it("limits an owned page to 60 lines with thin-page and a Makerkit location", () => {
    const page = `${MAKERKIT_ROUTE}/page.tsx`;
    const repo = makerkitRepo({ [page]: `export default function Page() {\n${"  void 0;\n".repeat(60)}  return null;\n}\n` });
    const findings = auditChanged(repo.root, [page]);
    expect(findings.map(({ rule }) => rule)).toEqual(["thin-page"]);
    expect(findings[0]?.message).toContain("(Makerkit layout)");
  });

  it("leaves raw error text to the kit's i18n rule: no error-text in owned files", () => {
    const view = `${MAKERKIT_ROUTE}/_components/journal-error.tsx`;
    const boundary = `${MAKERKIT_ROUTE}/error.tsx`;
    const text = "export const View = ({ error }: { error: Error }) => <p>{error.message}</p>;\n";
    const repo = makerkitRepo({ [view]: text, [boundary]: `"use client";\n${text}` });
    expect(rulesOf(repo.root, [view, boundary])).toEqual([]);
  });

  it("requires use server first in an owned action file", () => {
    const repo = makerkitRepo({ [action]: chain });
    expect(rulesOf(repo.root, [action])).toEqual([`${action} use-server-placement`]);
  });

  it("requires server-only in owned _lib/server/ files other than actions", () => {
    const file = `${MAKERKIT_ROUTE}/_lib/server/load-x.ts`;
    const repo = makerkitRepo({ [file]: "export const loadX = () => 1;\n" });
    const findings = auditChanged(repo.root, [file]);
    expect(findings.map(({ rule }) => rule)).toEqual(["server-only"]);
    expect(findings[0]?.message).toContain("_lib/server/");
  });

  it("allows process.env only in the kit's config and entry files", () => {
    const page = `${MAKERKIT_ROUTE}/page.tsx`;
    const repo = makerkitRepo({
      "harness.config.ts": makerkitConfig([`${MAKERKIT_ROUTE}/`, "apps/web/config/"]),
      [page]: "export default function Page() { return process.env.SUPABASE_SECRET_KEY; }\n",
    });
    expect(rulesOf(repo.root, [page, "apps/web/config/app.config.ts"])).toEqual([`${page} env-access`]);
  });

  it("allows NEXT_PUBLIC_* reads anywhere, but not other variables or a destructured env", () => {
    const page = `${MAKERKIT_ROUTE}/_components/journal-link.tsx`;
    const repo = makerkitRepo({
      [page]:
        'export const a = process.env.NEXT_PUBLIC_SITE_URL;\nexport const b = process.env["NEXT_PUBLIC_PRODUCT_NAME"];\nexport const c = process.env.EMAIL_SENDER;\nexport const { NEXT_PUBLIC_X } = process.env;\n',
    });
    expect(auditChanged(repo.root, [page]).map(({ rule, line }) => `${rule}:${line}`)).toEqual(["env-access:3", "env-access:4"]);
  });

  it("resolves ~/ aliases when a client component imports server code", () => {
    const file = `${MAKERKIT_ROUTE}/_components/journal-form.tsx`;
    const repo = makerkitRepo({
      [file]:
        '"use client";\nimport { requireUser } from "~/lib/server/require-user-in-server-component";\nimport { x } from "~/lib/x";\nexport const F = () => [requireUser, x];\n',
    });
    expect(auditChanged(repo.root, [file])).toEqual([expect.objectContaining({ rule: "client-imports-server", line: 2 })]);
  });
});

describe("makerkit-app Server Action imports", () => {
  const file = `${MAKERKIT_ROUTE}/_components/journal-form.tsx`;
  const client = (target: string): string => `"use client";\nimport { save } from "${target}";\nexport const F = () => save;\n`;

  it.each(["../_lib/server/server-actions", "~/home/[account]/journal/_lib/server/journal-server-actions"])(
    "lets a client component import the route's Server Action from %s",
    (target) => {
      const repo = makerkitRepo({ [file]: client(target) });
      expect(rulesOf(repo.root, [file])).toEqual([]);
    },
  );

  it("still flags other server code imported through ~/lib/server/", () => {
    const repo = makerkitRepo({ [file]: client("~/lib/server/require-user-in-server-component") });
    expect(rulesOf(repo.root, [file])).toEqual([`${file} client-imports-server`]);
  });
});

describe("makerkit-app code index", () => {
  it("lists route server actions and config exports", () => {
    const repo = makerkitRepo();
    const index = codeIndex(repo.root);
    expect(index).toContain("# apps/web");
    expect(index).toContain("- `app/[locale]/home/[account]/billing/_lib/server/server-actions.ts`: `createCheckout`");
    expect(index).toContain("- `config/paths.config.ts`: `pathsConfig`");
    expect(index).toContain("- `config/app.config.ts`: (no named exports)");
  });
});
