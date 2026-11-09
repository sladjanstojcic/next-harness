import { describe, expect, it } from "vitest";
import { makerkitConfig, makerkitRepo } from "../../testing/makerkit-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { parseEvent, type HookEvent } from "./event.ts";
import { checkGuards } from "./guards.ts";

const shell = (root: string, command: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root);
const write = (root: string, file: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "" } }, root);

const DEPLOY_REASON = "Applying schema changes to a linked project is the user's step; leave migrations committed and ask them to deploy.";

describe("supabase deploy guards (commands are inspected, never executed)", () => {
  it.each([
    ["supabase db push", "supabase-push"],
    ["pnpm build && supabase db push", "supabase-push"],
    ["npx supabase db push", "supabase-push"],
    ["pnpm exec supabase db push --dry-run", "supabase-push"],
    ["supabase --workdir apps/web db push", "supabase-push"],
    ["supabase link", "supabase-link"],
    ["supabase link --project-ref abc", "supabase-link"],
    ["cd apps/web && supabase link --project-ref $SUPABASE_PROJECT_REF", "supabase-link"],
    ["pnpm supabase:deploy", "supabase-deploy"],
    ["pnpm --filter web supabase:deploy", "supabase-deploy"],
    ["pnpm run supabase:deploy", "supabase-deploy"],
    ["pnpm -C apps/web run supabase:deploy", "supabase-deploy"],
    ["npx supabase@latest db push", "supabase-push"],
    ["$(which supabase) db push", "supabase-push"],
    ["supabase -x studio,imgproxy db push", "supabase-push"],
    ["pnpm --filter web supabase -- db push", "supabase-push"],
    ["bash -c 'supabase db push'", "supabase-push"],
    ['sh -c "cd apps/web && supabase db push"', "supabase-push"],
    ["cd apps/web && supabase link --project-ref $REF && supabase db push", "supabase-push"],
    ["supabase 'db' push", "supabase-push"],
    ["supabase db 'push'", "supabase-push"],
    ['supabase "db" "push"', "supabase-push"],
    ["supabase d\\b push", "supabase-push"],
    ["supabase db pu\\sh", "supabase-push"],
    ["SUPABASE db push", "supabase-push"],
    ["supabase 'link'", "supabase-link"],
    ["supabase migration up --linked", "supabase-migration-up"],
    ["npx supabase --workdir apps/web migration up --include-all --linked", "supabase-migration-up"],
    ["echo 'never run supabase db push yourself'", "supabase-push"],
    ["supabase db --debug push", "supabase-push"],
    ["supabase db --experimental push", "supabase-push"],
    ["supabase db --workdir apps/web push", "supabase-push"],
    ["supabase db --dns-resolver https push", "supabase-push"],
    ["supabase migration --debug up --linked", "supabase-migration-up"],
    ["supabase db $'push'", "supabase-push"],
    ["supabase $'db' push", "supabase-push"],
    ['supabase $"db" push', "supabase-push"],
  ])("denies %s", (command, guard) => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, command), root)).toEqual({ guard, reason: DEPLOY_REASON });
  });

  it.each([
    "supabase start",
    "supabase stop",
    "supabase db reset",
    "supabase migration new add_journal",
    "supabase db diff -f add_journal",
    "supabase test db",
    "pnpm supabase:web:start",
    "pnpm supabase:web:reset",
    "pnpm --filter web supabase:typegen",
    "supabase db lint --linked",
    "supabase migration up",
    "supabase migration up --local",
    "supabase migration list --linked",
    "supabase db pull --linked",
    "supabase db dump --local",
    "supabase migration repair 20240101000000 --status applied --linked",
    "cat apps/web/supabase/README-link.md",
    'hc send t2yw "the supabase guards deny db push and link"',
    "grep -i 'supabase-link' .git/harness/blocks.jsonl",
    "grep -n 'supabase:deploy' apps/web/package.json",
    "supabase link-check",
  ])("allows %s", (command) => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, command), root)).toBeNull();
  });

  it("stops the reset and telemetry guards at a line break", () => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, "supabase db reset\necho done\necho --linked"), root)).toBeNull();
    expect(checkGuards(shell(root, "supabase db reset\nsupabase db reset --linked"), root)?.guard).toBe("destructive-supabase");
    expect(checkGuards(shell(root, "pnpm harness:blocks\necho --false"), root)).toBeNull();
    expect(checkGuards(shell(root, "pnpm harness:blocks --false abc"), root)?.guard).toBe("harness-telemetry");
  });

  it("keeps the earlier destructive guard first", () => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, "supabase db reset --linked && supabase db push"), root)?.guard).toBe("destructive-supabase");
  });
});

describe("env files under env: local", () => {
  it.each([".env.local", "apps/web/.env.production.local", ".env.development.local", "apps/web/.env.test.local"])("denies %s", (file) => {
    const { root } = makerkitRepo({ "harness.config.ts": makerkitConfig(undefined, "local") });
    expect(checkGuards(write(root, file), root)).toEqual({
      guard: "env-file-write",
      reason: `${file} holds the user's secrets; agent-authored configuration belongs in the committed .env files without .local.`,
    });
  });

  it.each(["apps/web/.env.development", "apps/web/.env", "apps/web/.env.production", "apps/web/.env.test"])("allows %s", (file) => {
    const { root } = makerkitRepo({ "harness.config.ts": makerkitConfig(undefined, "local") });
    expect(checkGuards(write(root, file), root)).toBeNull();
  });

  it("keeps the other guards on an allowed env name", () => {
    const { root } = makerkitRepo({ "harness.config.ts": makerkitConfig(undefined, "local").replace("env: ", 'locked: ["apps/web/.env"],\n  env: ') });
    expect(checkGuards(write(root, "apps/web/.env"), root)?.guard).toBe("harness-lock");
  });

  it.each([
    [".env.local", "denied"],
    [".env", "denied"],
    ["apps/web/.env.development", "denied"],
    [".env.example", "allowed"],
  ])("without a config file %s stays %s", (file, expected) => {
    const { root } = makeRepo();
    const denial = checkGuards(write(root, file), root);
    expect(denial?.guard ?? "allowed").toBe(expected === "denied" ? "env-file-write" : "allowed");
  });

  it("denies every env name but .env.example when the config leaves env out", () => {
    const { root } = makerkitRepo();
    expect(checkGuards(write(root, "apps/web/.env.development"), root)).toEqual({
      guard: "env-file-write",
      reason: "apps/web/.env.development holds the user's secrets; agent-authored configuration belongs in .env.example.",
    });
  });
});
