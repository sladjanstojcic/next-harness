import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../../core/gates/ci-gate.ts";
import { doneGate } from "../../core/gates/done-gate.ts";
import * as runner from "../../core/gates/run-tool.ts";
import { initLegacy } from "../../core/legacy.ts";
import { resolveHarness } from "../../core/path-check.ts";
import type { RepoFixture } from "../temp-repo.ts";
import { PB, PB_MIGRATION, pocketbaseEslintRepo } from "./pocketbase-repo.ts";

afterEach(() => vi.restoreAllMocks());

const LONG = 300_000;
const LEGACY = "tooling/harness-legacy.json";
const NEW_MIGRATION = `${PB}/pb_migrations/002_second_collection.ts`;
/** A cast the preset reports and no edit of an applied migration may remove. */
const CAST = 'migrate(\n  () => undefined,\n  () => undefined,\n);\n\nconst value = JSON.parse("1") as number;\nexport { value };\n';

/** The PocketBase folder on ESLint and Prettier, its migration with a lint finding pushed to the remote default branch. */
function appliedRepo(legacy: boolean): { repo: RepoFixture; root: string } {
  const repo = pocketbaseEslintRepo({}, { legacy });
  repo.write(PB_MIGRATION, CAST);
  repo.git("commit", "-qam", "Migration with a cast");
  repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  const root = fs.realpathSync(repo.root);
  const real = runner.runTool;
  vi.spyOn(runner, "runTool").mockImplementation((at, step) => (step.cwd?.startsWith(path.join(root, PB)) === true ? real(at, step) : Promise.resolve([])));
  return { repo, root };
}

const addNewMigration = (repo: RepoFixture): void => {
  repo.write(NEW_MIGRATION, CAST);
  repo.git("add", NEW_MIGRATION);
  repo.git("commit", "-qm", "New migration with a cast");
};

const lintLine = (report: string): string | undefined => report.split("\n").find((line) => line.startsWith(`eslint (${PB})`));

describe("a tool finding on an applied migration", () => {
  it(
    "passes the CI gate as pre-existing and stays off the legacy list, while a new migration with it fails",
    async () => {
      const { repo, root } = appliedRepo(true);
      const applied = await ciGate(root);
      expect(applied.findings).toEqual([]);
      expect(applied.preExisting.map(({ file }) => file)).toContain(PB_MIGRATION);
      expect(applied.report).toContain(`Pre-existing in applied migrations (not blocking):`);
      repo.remove(LEGACY);
      await initLegacy(root, resolveHarness(root));
      expect(repo.read(LEGACY)).not.toContain(PB_MIGRATION);

      repo.write(LEGACY, '{ "version": 1, "files": [] }\n');
      addNewMigration(repo);
      const fresh = await ciGate(root);
      expect(fresh.passed).toBe(false);
      expect(fresh.findings.map(({ file }) => file)).toContain(NEW_MIGRATION);
      expect(fresh.findings.map(({ file }) => file)).not.toContain(PB_MIGRATION);
    },
    LONG,
  );

  it(
    "passes lint without a legacy list too, and a new migration with it fails",
    async () => {
      const { repo, root } = appliedRepo(false);
      expect(lintLine((await ciGate(root)).report)).toBe(`eslint (${PB}): passed`);
      addNewMigration(repo);
      expect(lintLine((await ciGate(root)).report)).toBe(`eslint (${PB}): failed`);
    },
    LONG,
  );

  it(
    "does not block the Done gate when the turn touched the migration",
    async () => {
      const { root } = appliedRepo(false);
      const result = await doneGate(root, [PB_MIGRATION]);
      expect(result.findings.filter(({ file }) => file === PB_MIGRATION)).toEqual([]);
      expect(result.preExisting.map(({ file }) => file)).toContain(PB_MIGRATION);
    },
    LONG,
  );
});
