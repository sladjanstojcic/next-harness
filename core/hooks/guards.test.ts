import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { checkPath } from "../path-check.ts";
import { parseEvent, type HookEvent } from "./event.ts";
import { unlock } from "../lock.ts";
import { checkGuards } from "./guards.ts";

const shell = (root: string, command: string, cwd = root): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root);
const fileEvent = (root: string, file: string, tool = "Write"): HookEvent =>
  parseEvent(
    "claude",
    {
      session_id: "s",
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { file_path: file, content: "", old_string: "x", new_string: "y" },
    },
    root,
  );
const patchEvent = (root: string, body: string): HookEvent =>
  parseEvent(
    "codex",
    {
      session_id: "s",
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` },
    },
    root,
  );

describe("command guards (commands are inspected, never executed)", () => {
  it.each([
    ["prisma migrate reset", "destructive-prisma"],
    ["pnpm exec prisma migrate dev", "destructive-prisma"],
    ["prisma db execute", "destructive-prisma"],
    ["prisma db pull", "destructive-prisma"],
    ["prisma db push --force-reset", "destructive-prisma"],
    ["prisma db push --accept-data-loss", "destructive-prisma"],
    ["PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 prisma db push", "destructive-prisma"],
    ["supabase db reset --linked", "destructive-supabase"],
    ["supabase db reset --project-ref abc", "destructive-supabase"],
    ["git push --force", "git-force-push"],
    ["git push --force-if-includes", "git-force-push"],
    ["git push origin +main", "git-force-push"],
    ["git -C somewhere push --force", "git-force-push"],
    ['git -C "path with spaces" push --force-with-lease', "git-force-push"],
    ["git push -uf origin main", "git-force-push"],
    ["git push -fu origin main", "git-force-push"],
    ["find . -delete", "rm-outside-repo"],
    ["find . -exec rm -rf {} +", "rm-outside-repo"],
    ["git push -f", "git-force-push"],
    ["git push --force-with-lease", "git-force-push"],
    ["rm -rf ../x", "rm-outside-repo"],
    ["/bin/rm -rf ~/x", "rm-outside-repo"],
    ["find .. -delete", "rm-outside-repo"],
    ["find /tmp -exec rm {} \\;", "rm-outside-repo"],
    ["rm -rf .git", "rm-outside-repo"],
    ["rm -rf .", "rm-outside-repo"],
    ['rm -rf "$HOME/x"', "rm-outside-repo"],
    ['rm -rf "${HOME}/x"', "rm-outside-repo"],
    ["git status && rm -rf ../x", "rm-outside-repo"],
    ["pnpm harness:unlock", "harness-lock"],
    ["node tooling/harness/cli.ts unlock", "harness-lock"],
    ['pnpm harness:blocks --false 1a2b3c "generated page"', "harness-telemetry"],
  ])("denies %s using %s", (command, guard) => {
    const { root } = makeRepo();
    const denial = checkGuards(shell(root, command), root);
    expect(denial?.guard).toBe(guard);
    expect(denial?.reason).toBeTruthy();
  });

  it.each([
    "prisma generate",
    "prisma db push",
    "supabase db reset",
    "supabase start",
    "git push",
    "git push origin main",
    "git -C somewhere push -u origin main",
    "find . -iname cache -delete",
    "find . -path ./cache -delete",
    "rm -rf src/x",
    "find src -name x",
    "find src -delete",
    "find . -name x -delete",
    "find src -exec rm {} \\;",
    "pnpm dlx shadcn add button",
    "cat .env.example",
    "git diff",
    "rm -rf ..cache",
  ])("allows %s", (command) => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, command), root)).toBeNull();
  });

  it("resolves removals from the event cwd and follows symlink ancestors", () => {
    const { root } = makeRepo({ "src/x.ts": "" });
    expect(checkGuards(shell(root, "rm ../src/x.ts", path.join(root, "src")), root)).toBeNull();
    fs.symlinkSync(path.dirname(root), path.join(root, "outside"));
    expect(checkGuards(shell(root, "rm -rf outside/new-file", root), root)?.guard).toBe("rm-outside-repo");
  });

  it("evaluates destructive commands in the prescribed order", () => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, "git push -f; supabase db reset --linked; prisma migrate reset; rm .."), root)?.guard).toBe("destructive-prisma");
    expect(checkGuards(shell(root, "git push -f; supabase db reset --linked; rm .."), root)?.guard).toBe("destructive-supabase");
    expect(checkGuards(shell(root, "rm ..; git push -f"), root)?.guard).toBe("git-force-push");
  });
});

describe("file guards", () => {
  it.each([
    [".env", "env-file-write"],
    [".env.local", "env-file-write"],
    ["src/modules/a/.env.production", "env-file-write"],
    ["pnpm-lock.yaml", "lockfile-write"],
    ["src/shared/ui/button.tsx", "vendored-write"],
    ["src/shared/lib/utils.ts", "vendored-write"],
  ])("protects %s via %s even when Git ignores it", (file, guard) => {
    const { root } = makeRepo({ ".gitignore": `${file}\n` });
    expect(checkGuards(fileEvent(root, file, "Edit"), root)).toMatchObject({ guard });
  });

  it.each([".env.example", "package.json", "src/shared/components/x.tsx", "src/modules/a/server/get-a.ts", ".next/x", "/tmp/x"])(
    "allows writing %s",
    (file) => {
      const { root } = makeRepo({ ".gitignore": ".next/\n" });
      expect(checkGuards(fileEvent(root, file), root)).toBeNull();
    },
  );

  it.each([
    ["src/utils/x.ts", "src-shape"],
    ["src/modules/orders/helpers/x.ts", "module-shape"],
    ["lib/x.ts", "unknown-root"],
    ["src/modules/orders/components/OrderRow.tsx", "file-name"],
  ])("denies the Claude Write envelope for %s with the %s placement reason", (file, rule) => {
    const { root } = makeRepo();
    const verdict = checkPath(file);
    expect(verdict).toMatchObject({ ok: false, rule });
    if (verdict.ok) throw new Error("Expected an invalid path");
    expect(checkGuards(fileEvent(root, file), root)).toEqual({ guard: "structure-write", reason: `${rule}: ${verdict.reason}` });
  });

  it.each([
    ["src/shared/ui/button.tsx", "add primitives with `pnpm dlx shadcn add <name>`; customise in src/shared/components/"],
    ["src/backend/database.types.ts", "regenerate src/backend/database.types.ts with the backend's CLI; keep your own types in a module's types.ts"],
  ])("gives the vendored remediation for %s", (file, reason) => {
    const { root } = makeRepo();
    expect(checkGuards(fileEvent(root, file), root)?.reason).toBe(reason);
  });

  it("resolves file tools through a symlinked repository path", () => {
    const { root } = makeRepo();
    const alias = path.join(path.dirname(root), "alias");
    fs.symlinkSync(root, alias);
    expect(checkGuards(fileEvent(root, `${alias}/.env.local`), root)?.guard).toBe("env-file-write");
  });

  it("does not treat a tracked path matching an ignore pattern as ignored", () => {
    const repo = makeRepo({ "src/utils/x.ts": "" });
    repo.write(".gitignore", "src/utils/\n");
    expect(checkGuards(fileEvent(repo.root, "src/utils/x.ts"), repo.root)?.guard).toBe("structure-write");
  });

  it("does not enforce pre-tool guards after mutation or at stop", () => {
    const { root } = makeRepo();
    const event = fileEvent(root, ".env.local");
    expect(checkGuards({ ...event, event: "post-tool" }, root)).toBeNull();
    expect(checkGuards({ ...event, event: "stop" }, root)).toBeNull();
  });
});

describe("patch guards", () => {
  it("does not guard a protected path mentioned only in Update context", () => {
    const { root } = makeRepo();
    const event = patchEvent(root, "*** Update File: src/shared/lib/x.ts\n@@\n *** Delete File: .env\n-old\n+new");
    expect(checkGuards(event, root)).toBeNull();
  });

  it.each([
    "*** Add File: src/helpers/x.ts\n+x",
    "*** Update File: src/utils/x.ts\n@@\n-x\n+y",
    "*** Update File: src/modules/a/server/x.ts\n*** Move to: src/utils/x.ts\n@@\n x",
  ])("denies invalid write targets %#", (body) => {
    const { root } = makeRepo();
    expect(checkGuards(patchEvent(root, body), root)?.guard).toBe("structure-write");
  });

  it.each(["*** Delete File: src/utils/x.ts", "*** Update File: src/utils/x.ts\n*** Move to: src/modules/a/server/x.ts\n@@\n x"])(
    "allows removing code from an invalid location %#",
    (body) => {
      const { root } = makeRepo();
      expect(checkGuards(patchEvent(root, body), root)).toBeNull();
    },
  );

  it.each([
    [".env.local", "env-file-write"],
    ["pnpm-lock.yaml", "lockfile-write"],
    ["src/shared/ui/button.tsx", "vendored-write"],
  ])("still protects %s when deleting or moving it", (file, guard) => {
    const { root } = makeRepo();
    expect(checkGuards(patchEvent(root, `*** Delete File: ${file}`), root)?.guard).toBe(guard);
    expect(checkGuards(patchEvent(root, `*** Update File: ${file}\n*** Move to: src/shared/lib/x.ts\n@@\n x`), root)?.guard).toBe(guard);
  });
});

describe("harness lock guard", () => {
  it("denies edits to harness files until the user unlocks, then allows them for the unlock window", () => {
    const { root } = makeRepo();
    expect(checkGuards(fileEvent(root, "tooling/harness/structure.ts", "Edit"), root)?.guard).toBe("harness-lock");
    expect(checkGuards(fileEvent(root, ".claude/settings.json"), root)?.reason).toContain("pnpm harness:unlock");
    expect(checkGuards(fileEvent(root, ".github/workflows/check.yml", "Edit"), root)?.guard).toBe("harness-lock");
    expect(checkGuards(fileEvent(root, "src/modules/orders/index.ts"), root)).toBeNull();
    unlock(root);
    expect(checkGuards(fileEvent(root, "tooling/harness/structure.ts", "Edit"), root)).toBeNull();
    expect(checkGuards(fileEvent(root, ".claude/settings.json"), root)).toBeNull();
  });
});

describe("init --force guard", () => {
  it("denies init --force while the harness is locked and allows it, and plain init, otherwise", () => {
    const { root } = makeRepo();
    for (const command of ["node tooling/harness/cli.ts init --force", "node tooling/harness/cli.ts init --codex-user --force", "pnpm harness:init --force"]) {
      expect(checkGuards(shell(root, command), root)?.guard, command).toBe("harness-lock");
    }
    expect(checkGuards(shell(root, "node tooling/harness/cli.ts init"), root)).toBeNull();
    expect(checkGuards(shell(root, "pnpm codex:hooks"), root)).toBeNull();
    expect(checkGuards(shell(root, "node tooling/harness/cli.ts init && git commit --force-x"), root)).toBeNull();
    unlock(root);
    expect(checkGuards(shell(root, "node tooling/harness/cli.ts init --force"), root)).toBeNull();
  });
});

describe("telemetry guard", () => {
  it("lets agents list blocks and only denies marking one false", () => {
    const { root } = makeRepo();
    expect(checkGuards(shell(root, "pnpm harness:blocks"), root)).toBeNull();
    expect(checkGuards(shell(root, "node tooling/harness/cli.ts blocks"), root)).toBeNull();
    expect(checkGuards(shell(root, "node tooling/harness/cli.ts blocks --false 1a2b3c"), root)?.guard).toBe("harness-telemetry");
  });
});
