import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../../core/audit/audit.ts";
import { runTool } from "../../core/gates/run-tool.ts";
import { parseEvent } from "../../core/hooks/event.ts";
import { handleEvent } from "../../core/hooks/handle.ts";
import { resolveHarness } from "../../core/path-check.ts";
import { depcruise } from "../../tools/analysis.ts";
import { templateRepo } from "../template-repo.ts";
import type { RepoFixture } from "../temp-repo.ts";
import { PB, PB_MIGRATION, POCKETBASE_PROJECT, pocketbaseRepo } from "./pocketbase-repo.ts";

const ENTRY = `${PB}/pb_hooks/sessions.pb.ts`;
const SHARED_VALUES = `${PB}/shared/listing-values.ts`;
const LISTINGS = "src/modules/listings";
const MIGRATE_DOWN = "pocketbase migrate down";

/** The app reads the values pocketbase/shared/ holds, from its domain/ and from its server/. */
const ACROSS: Readonly<Record<string, string>> = {
  [SHARED_VALUES]: 'export const LISTING_STATUSES = ["draft", "live"] as const;\n',
  [`${LISTINGS}/domain/status.ts`]:
    'import { LISTING_STATUSES } from "../../../../pocketbase/shared/listing-values.ts";\n\nexport const isLive = (status: string): boolean => status === LISTING_STATUSES[1];\n',
  [`${LISTINGS}/domain/status.test.ts`]:
    'import { expect, it } from "vitest";\nimport { isLive } from "./status.ts";\n\nit("reads live", () => {\n  expect(isLive("live")).toBe(true);\n});\n',
  [`${LISTINGS}/server/load.ts`]:
    'import "server-only";\nimport { LISTING_STATUSES } from "../../../../pocketbase/shared/listing-values.ts";\n\nexport const loadStatuses = (): readonly string[] => LISTING_STATUSES;\n',
};

function session(repo: RepoFixture) {
  const send = (tool: string, input: Record<string, unknown>) =>
    handleEvent(
      parseEvent("claude", { session_id: "pocketbase", cwd: repo.root, hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }, repo.root),
      repo.root,
    );
  return {
    write: (file: string) => send("Write", { file_path: path.join(repo.root, file), content: "" }),
    edit: (file: string) => send("Edit", { file_path: path.join(repo.root, file), old_string: "migrate", new_string: "migrate" }),
    shell: (command: string) => send("Bash", { command }),
  };
}

const found = (root: string): string[] => audit(fs.realpathSync(root)).map(({ file, rule }) => `${file} ${rule}`);

describe("a Next app with its PocketBase backend in pocketbase/", () => {
  it("passes the audit as written", () => {
    expect(found(pocketbaseRepo().root)).toEqual([]);
  });

  it.each([
    [`${PB}/pb_hooks/commands.ts`, "export const run = 1;\n", "module-shape"],
    [ENTRY, "export const route = 1;\n", "pb-entry-module"],
    [ENTRY, 'const { endSession } = require(`${__hooks}/sessions/end-session.ts`);\nrouterAdd("POST", "/x", () => endSession());\n', "pb-require-scope"],
    [`${PB}/shared/x.ts`, 'import fs from "node:fs";\n\nexport const read = fs.readFileSync;\n', "pb-shared-pure"],
    [ENTRY, '// oxlint-disable-next-line no-undef\nrouterAdd("GET", "/x", () => undefined);\n', "inline-disable"],
  ])("reports %s as %s's one finding", (file, text, rule) => {
    expect(found(pocketbaseRepo({ [file]: text }).root)).toEqual([`${file} ${rule}`]);
  });

  it("lets a test in tests/<suite>/ call the running server, and still reports a network call in a colocated unit test", () => {
    const health =
      'import { expect, it } from "vitest";\n\nit("answers", async () => {\n  expect((await fetch("http://127.0.0.1:8090/api/health")).ok).toBe(true);\n});\n';
    const status = `${LISTINGS}/domain/status.ts`;
    const statusTest = `${LISTINGS}/domain/status.test.ts`;
    const repo = pocketbaseRepo({
      [`${PB}/tests/sessions/health.test.ts`]: health,
      [status]: 'export const isLive = (status: string): boolean => status === "live";\n',
      [statusTest]: health.replace("answers", "reads live"),
    });
    expect(found(repo.root)).toEqual([`${statusTest} test-determinism`]);
  });

  it("denies a generic folder in pb_hooks/", async () => {
    const outcome = await session(pocketbaseRepo()).write(`${PB}/pb_hooks/utils/a.ts`);
    expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
    expect(outcome.reason).toContain("generic-folder");
  });

  it("denies an edit of a committed migration", async () => {
    expect(await session(pocketbaseRepo()).edit(PB_MIGRATION)).toMatchObject({ kind: "deny", guard: "migration-applied" });
  });

  it("denies rolling migrations back", async () => {
    expect(await session(pocketbaseRepo()).shell(MIGRATE_DOWN)).toMatchObject({ kind: "deny", guard: "pocketbase-migrate-down" });
  });

  it("leaves the root app's findings as they are without the pocketbase workspace", () => {
    const appOnly = 'export default { workspaces: [{ path: ".", shape: "next-modules", next: true }], root: { entries: ["pocketbase"] } };\n';
    const broken = { "src/lib/x.ts": "export const x = 1;\n" };
    const app = (root: string) => found(root).filter((entry) => !entry.startsWith(`${PB}/`));
    expect(app(pocketbaseRepo(broken).root)).toEqual(["src/lib/x.ts src-shape"]);
    expect(app(pocketbaseRepo({ ...broken, "harness.config.ts": appOnly }).root)).toEqual(["src/lib/x.ts src-shape"]);
  });
});

describe("imports across the app and pocketbase/", () => {
  it("allows the app's domain/ and server/ to import pocketbase/shared/: neither dependency-cruiser nor the audit reports it", async () => {
    const { root } = templateRepo({ ...POCKETBASE_PROJECT, ...ACROSS }, { stack: true });
    const app = resolveHarness(root).workspaces.find((workspace) => workspace.shape === "next-modules");
    if (app === undefined) throw new Error("the fixture has no next-modules workspace");
    expect(
      await runTool(
        root,
        depcruise.report(root, app, new Set(), () => undefined),
      ),
    ).toEqual([]);
    expect(found(root)).toEqual([]);
  }, 120_000);

  it.each([
    [
      `${LISTINGS}/server/load.ts`,
      'import "server-only";\nimport { endSession } from "../../../../pocketbase/pb_hooks/sessions/end-session.ts";\n\nexport const end = endSession;\n',
    ],
    [
      `${LISTINGS}/domain/status.ts`,
      'import type { Contract } from "../../../../pocketbase/types/contracts.ts";\n\nexport const isLive = (contract: Contract): boolean => contract.status === "live";\n',
    ],
    [
      SHARED_VALUES,
      'import { isLive } from "../../src/modules/listings/domain/status.ts";\n\nexport const LISTING_STATUSES = ["draft", "live"] as const;\nexport const live = isLive;\n',
    ],
  ])("reports %s crossing the boundary as pb-boundary", (file, text) => {
    const contracts = { [`${PB}/types/contracts.ts`]: "export interface Contract {\n  status: string;\n}\n" };
    expect(found(pocketbaseRepo({ ...ACROSS, ...contracts, [file]: text }).root)).toEqual([`${file} pb-boundary`]);
  });
});
