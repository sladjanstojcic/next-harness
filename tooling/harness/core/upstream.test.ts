import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { MAKERKIT_KIT_ROUTE, makerkitRepo } from "../testing/makerkit-repo.ts";
import { makeRepo } from "../testing/temp-repo.ts";
import { classify } from "./classes.ts";
import { parseEvent, type HookEvent } from "./hooks/event.ts";
import { checkGuards } from "./hooks/guards.ts";
import { isLocked } from "./lock.ts";
import { resolveHarness } from "./path-check.ts";
import { syncUpstream } from "./upstream.ts";

const LIST = "tooling/harness-upstream.json";
const config = (owned?: string[]): string =>
  `export default { workspaces: [{ path: ".", shape: "next-modules" }], upstream: "${LIST}"${owned === undefined ? "" : `, owned: ${JSON.stringify(owned)}`} };\n`;
const list = (files: string[]): string => `${JSON.stringify({ version: 1, files })}\n`;
const classOf = (root: string, file: string): string => classify(file, resolveHarness(root), new Set());

const writeEvent = (root: string, file: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "" } }, root);

describe("the upstream list", () => {
  it("makes a listed file the kit's and every other file the project's own", () => {
    const repo = makeRepo({ "harness.config.ts": config(), [LIST]: list(["src/modules/kit/index.ts"]) });
    expect(classOf(repo.root, "src/modules/kit/index.ts")).toBe("upstream");
    expect(classOf(repo.root, "src/modules/kit/new-file.ts")).toBe("owned");
    expect(classOf(repo.root, "src/modules/invoices/index.ts")).toBe("owned");
  });

  it("lets an owned prefix claim a listed path", () => {
    const repo = makeRepo({ "harness.config.ts": config(["src/modules/kit/"]), [LIST]: list(["src/modules/kit/index.ts", "src/modules/other/index.ts"]) });
    expect(classOf(repo.root, "src/modules/kit/index.ts")).toBe("owned");
    expect(classOf(repo.root, "src/modules/other/index.ts")).toBe("upstream");
  });

  it.each([
    ["missing", undefined],
    ["invalid", "{ nope"],
    ["of another shape", '{"files":"all"}'],
  ])("judges every file while the list is %s", (_name, text) => {
    const repo = makeRepo({ "harness.config.ts": config(), ...(text === undefined ? {} : { [LIST]: text }) });
    expect(classOf(repo.root, "src/modules/kit/index.ts")).toBe("owned");
  });

  it("is locked", () => {
    const repo = makeRepo({ "harness.config.ts": config() });
    expect(isLocked(LIST, loadConfig(repo.root))).toBe(true);
  });
});

describe("upstream sync", () => {
  it("lists every tracked file but itself the first time, and refuses a second run without a ref", () => {
    const repo = makeRepo({ "harness.config.ts": config(), "src/modules/kit/index.ts": "export const kit = 1;\n" });
    repo.write("untracked.ts", "");
    expect(syncUpstream(repo.root, loadConfig(repo.root), undefined)).toContain("2 files");
    expect(JSON.parse(repo.read(LIST))).toEqual({ version: 1, files: ["harness.config.ts", "src/modules/kit/index.ts"] });
    expect(() => syncUpstream(repo.root, loadConfig(repo.root), undefined)).toThrow(/already exists/);
  });

  it("with a ref lists the tracked files that exist in it, and refreshes after a kit update", () => {
    const repo = makeRepo({ "harness.config.ts": config(), "src/modules/kit/index.ts": "export const kit = 1;\n", "src/modules/kit/old.ts": "" });
    repo.git("branch", "kit");
    repo.write("src/modules/mine/index.ts", "export const mine = 1;\n");
    repo.remove("src/modules/kit/old.ts");
    repo.git("add", "-A");
    syncUpstream(repo.root, loadConfig(repo.root), "kit");
    expect(JSON.parse(repo.read(LIST))).toEqual({ version: 1, files: ["harness.config.ts", "src/modules/kit/index.ts"] });

    repo.git("commit", "-q", "-m", "Mine");
    repo.git("checkout", "-q", "kit");
    repo.write("src/modules/kit/added.ts", "");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "Kit update");
    repo.git("checkout", "-q", "main");
    repo.git("merge", "-q", "kit", "-m", "Merge the kit");
    syncUpstream(repo.root, loadConfig(repo.root), "kit");
    expect(JSON.parse(repo.read(LIST))).toEqual({ version: 1, files: ["harness.config.ts", "src/modules/kit/added.ts", "src/modules/kit/index.ts"] });
  });

  it("fails on an unknown ref and without an upstream path", () => {
    const repo = makeRepo({ "harness.config.ts": config() });
    expect(() => syncUpstream(repo.root, loadConfig(repo.root), "no-such-ref")).toThrow(/git ls-tree/);
    expect(() => syncUpstream(repo.root, { workspaces: [{ path: ".", shape: "next-modules" }] }, undefined)).toThrow(/sets no upstream path/);
  });
});

describe("a Makerkit project with an upstream list instead of owned paths", () => {
  const KIT_CONFIG = `export default {
  workspaces: [
    { path: "apps/web", shape: "makerkit-app", next: true },
    { path: "apps/web/supabase", shape: "supabase" },
    { path: "packages/features/*", shape: "makerkit-feature" },
  ],
  upstream: "${LIST}",
  root: { entries: ["apps", "packages"] },
};
`;

  function kitRepo() {
    const repo = makerkitRepo({ "harness.config.ts": KIT_CONFIG });
    syncUpstream(repo.root, loadConfig(repo.root), undefined);
    return repo;
  }
  const guard = (root: string, file: string) => checkGuards(writeEvent(root, path.join(root, file)), root);

  it("judges a feature package nobody listed", () => {
    const repo = kitRepo();
    expect(guard(repo.root, "packages/features/invoices/src/utils/format.ts")).toMatchObject({ guard: "structure-write" });
    expect(guard(repo.root, "packages/features/invoices/src/server/services/invoice.service.ts")).toBeNull();
    expect(guard(repo.root, "packages/features/notes.md")).toBeNull();
  });

  it("judges a new file in a kit folder and leaves the kit's own file alone", () => {
    const repo = kitRepo();
    expect(guard(repo.root, `${MAKERKIT_KIT_ROUTE}/helpers/format.ts`)).toMatchObject({ guard: "structure-write" });
    expect(guard(repo.root, `${MAKERKIT_KIT_ROUTE}/page.tsx`)).toBeNull();
  });
});
