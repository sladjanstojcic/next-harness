import { describe, expect, it } from "vitest";
import type { WorkspaceEntry } from "../../config.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { rootIgnoreSteps } from "./ignore-files.ts";

const APP: WorkspaceEntry = { path: "", shape: "next-modules", tools: "eslint-prettier", next: true };
const pocketbaseAt = (folder: string): WorkspaceEntry => ({ path: folder, shape: "pocketbase", tools: "oxc", next: false });
const APP_LINES = "pnpm-lock.yaml\nsrc/shared/ui\nsrc/backend/*.types.ts\nsrc/backend/*-types.ts\n.next\n";
const HARNESS_LINES = "tooling/harness\nharness.config.ts\n";

/** The root .prettierignore step for an app at the root with pocketbase folders, applied to a project holding `existing`. */
function prettierStep(existing: string | undefined, folders: readonly string[] = ["pocketbase"]) {
  const repo = makeRepo({ "package.json": "{}\n", ...(existing === undefined ? {} : { ".prettierignore": existing }) });
  const step = rootIgnoreSteps(repo.root, [APP, ...folders.map(pocketbaseAt)]).find((each) => each.target === ".prettierignore");
  step?.apply?.();
  return { step, text: repo.read(".prettierignore") };
}

describe("a pocketbase folder is ignored at the root only", () => {
  it("writes the folder anchored, so a nested folder of the same name is still formatted", () => {
    const { step, text } = prettierStep(undefined);
    expect(step?.status).toBe("created");
    expect(text).toBe(`${APP_LINES}/pocketbase\n${HARNESS_LINES}`);
  });

  it("anchors the unanchored line an older init wrote, in place, and names the change", () => {
    const { step, text } = prettierStep(`build\n${APP_LINES}pocketbase\n${HARNESS_LINES}`);
    expect(step?.status).toBe("updated");
    expect(step?.detail).toBe("pocketbase → /pocketbase");
    expect(text).toBe(`build\n${APP_LINES}/pocketbase\n${HARNESS_LINES}`);
  });

  it("anchors the older line with a trailing slash too", () => {
    expect(prettierStep(`${APP_LINES}pocketbase/\n${HARNESS_LINES}`).text).toBe(`${APP_LINES}/pocketbase\n${HARNESS_LINES}`);
  });

  it("leaves an anchored line, and a user's own unanchored line, as they are", () => {
    for (const existing of [`build\n${APP_LINES}/pocketbase\n${HARNESS_LINES}`, `build\n${APP_LINES}/pocketbase/\n${HARNESS_LINES}`]) {
      const { step, text } = prettierStep(existing);
      expect(step?.status).toBe("unchanged");
      expect(text).toBe(existing);
    }
  });

  it("keeps a nested folder's line, which gitignore syntax already anchors, without rewriting it", () => {
    const existing = `${APP_LINES}apps/pocketbase\n${HARNESS_LINES}`;
    const { step, text } = prettierStep(existing, ["apps/pocketbase"]);
    expect(step?.status).toBe("unchanged");
    expect(text).toBe(existing);
    expect(prettierStep(undefined, ["apps/pocketbase"]).text).toBe(`${APP_LINES}/apps/pocketbase\n${HARNESS_LINES}`);
  });
});
