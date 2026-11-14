import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { parseEvent } from "./event.ts";
import { checkGuards, type Denial } from "./guards.ts";

const deny = (command: string): Denial | null => {
  const { root } = makeRepo();
  return checkGuards(
    parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root),
    root,
  );
};

describe("pocketbase migration guards (commands are inspected, never executed)", () => {
  it.each([
    ["pocketbase migrate down", "pocketbase-migrate-down"],
    ["./pocketbase migrate down 2", "pocketbase-migrate-down"],
    ["pocketbase/.runtime/0.40.5/darwin_arm64/pocketbase --dir pb_data migrate down", "pocketbase-migrate-down"],
    ["npx pocketbase migrate down", "pocketbase-migrate-down"],
    ['sh -c "pocketbase migrate down"', "pocketbase-migrate-down"],
    ["pocketbase migrate history-sync", "pocketbase-history-sync"],
    ["./pocketbase --dir=pb_data migrate history-sync", "pocketbase-history-sync"],
    ["true;pocketbase migrate down", "pocketbase-migrate-down"],
    ["true&&pocketbase migrate history-sync", "pocketbase-history-sync"],
  ])("denies %s", (command, guard) => {
    expect(deny(command)?.guard).toBe(guard);
  });

  it.each([
    "pocketbase migrate up",
    "pocketbase migrate create add_index",
    "pocketbase migrate collections",
    "pocketbase serve",
    "pocketbase superuser upsert a@b.c pw",
    "pocketbase --version",
    "ls pocketbase/pb_migrations",
    "git mv pocketbase/pb_migrations/down.ts x",
    "echo migrate down",
  ])("allows %s", (command) => {
    expect(deny(command)).toBeNull();
  });

  it("gives each guard its reason", () => {
    expect(deny("pocketbase migrate down")?.reason).toBe(
      "Reverting applied migrations drops what they created; write a new migration that undoes the change and let the user run it.",
    );
    expect(deny("pocketbase migrate history-sync")?.reason).toBe(
      "Rewriting the record of applied migrations is the user's step; leave the migration files as they are and ask them.",
    );
  });
});
