import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../../core/audit/audit.ts";
import { parseEvent } from "../../core/hooks/event.ts";
import { checkGuards } from "../../core/hooks/guards.ts";
import { checkPath, resolveHarness } from "../../core/path-check.ts";
import { PB, PB_MIGRATION, pocketbaseRepo } from "../../testing/pocketbase/pocketbase-repo.ts";

describe("pocketbase shape", () => {
  const harness = resolveHarness(pocketbaseRepo().root);
  const verdict = (file: string) => checkPath(`${PB}/${file}`, harness);

  it.each([
    "tsconfig.json",
    "package.json",
    "README.md",
    "README-deploy.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    "pb_hooks/sessions.pb.ts",
    "pb_hooks/listing-sync.pb.ts",
    "pb_hooks/.gitkeep",
    "pb_hooks/sessions/end-session.ts",
    "pb_hooks/renewals/commands.ts",
    "pb_migrations/001_first_collection.ts",
    "pb_migrations/1700000000_add-index.ts",
    "pb_migrations/.gitkeep",
    "shared/listing-values.ts",
    "types/pocketbase-0.40.5.d.ts",
    "types/pocketbase.d.ts",
    "types/contracts.ts",
    "types/host.d.ts",
    "types/LICENSE-PocketBase.md",
    "tests/renewals/admission.test.ts",
    "tests/renewals/olx-fixture.ts",
    "tests/access/matrix/calls/read.test.ts",
  ])("accepts %s", (file) => {
    expect(verdict(file)).toEqual({ ok: true });
  });

  it("accepts the fixture's own migration", () => {
    expect(checkPath(PB_MIGRATION, harness)).toEqual({ ok: true });
  });

  it.each([
    ["pb_public/index.html", "unknown-root"],
    ["release.json", "unknown-root"],
    ["pb_hooks/commands.ts", "module-shape"],
    ["pb_hooks/renewals/renewals.pb.ts", "module-shape"],
    ["pb_hooks/Sessions.pb.ts", "file-name"],
    ["pb_hooks/renewals/deep/commands.ts", "nesting"],
    ["pb_hooks/utils/format.ts", "generic-folder"],
    ["pb_hooks/sessions/readme.md", "module-shape"],
    ["pb_migrations/add_index.ts", "module-shape"],
    ["pb_migrations/2026/001_first.ts", "module-shape"],
    ["pb_migrations/001_First.ts", "module-shape"],
    ["shared/values/listing.ts", "nesting"],
    ["shared/ListingValues.ts", "file-name"],
    ["types/generated/host.d.ts", "nesting"],
    ["tests/admission.test.ts", "module-shape"],
    ["tests/a/b/c/d/read.test.ts", "nesting"],
    ["tests/helpers/olx.ts", "generic-folder"],
    ["pb_hooks/.hidden.ts", "hidden-file"],
    ["pb_migrations/001_first.js", "js-file"],
  ])("denies %s as %s", (file, rule) => {
    const found = verdict(file);
    expect(found).toMatchObject({ ok: false, rule });
    if (!found.ok && rule !== "js-file" && rule !== "unknown-root") expect(found.reason).toMatch(/\(PocketBase layout\)\.$/);
  });

  it("counts no folder size in pb_migrations", () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`pocketbase/pb_migrations/${String(n + 2).padStart(3, "0")}_step.ts`, "\n"]));
    expect(audit(pocketbaseRepo(files).root).filter(({ rule }) => rule === "folder-size")).toEqual([]);
  });

  it("reports an eleventh entry file as folder-size, with the shape's guidance", () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`pocketbase/pb_hooks/area-${String(n)}.pb.ts`, "\n"]));
    const found = audit(pocketbaseRepo(files).root).filter(({ rule }) => rule === "folder-size");
    expect(found).toHaveLength(11);
    expect(found[0]?.message).toContain("(PocketBase layout)");
  });

  it("denies a write to the vendored declarations with the shape's own reason", () => {
    const { root } = pocketbaseRepo();
    const file = "pocketbase/types/pocketbase-0.40.5.d.ts";
    const event = parseEvent(
      "claude",
      { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(root, file), content: "" } },
      root,
    );
    expect(checkGuards(event, root)).toEqual({
      guard: "vendored-write",
      reason: `take ${file} from the PocketBase release that matches your binary; keep your own declarations in another file in types/`,
    });
  });
});
