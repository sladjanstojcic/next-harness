import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makerkitConfig, makerkitRepo } from "../../testing/makerkit-repo.ts";
import { dashboardRepo } from "../../testing/dashboard-repo.ts";
import { makeRepo, type RepoFixture } from "../../testing/temp-repo.ts";
import { ciGate } from "../gates/ci-gate.ts";
import * as runner from "../gates/run-tool.ts";
import { resolveHarness } from "../path-check.ts";
import { parseEvent } from "./event.ts";
import { handleEvent } from "./handle.ts";
import { lintConfigFindings, lintConfigReason } from "./lint-config-guard.ts";

afterEach(() => vi.restoreAllMocks());

const NESTED = "packages/features/.oxlintrc.json";

function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "scan", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    /** A shell command: PreToolUse, the command's effect, then PostToolUse. */
    async shell(command: string, effect: () => void) {
      const input = { tool_name: "Bash", tool_input: { command } };
      expect(await send("PreToolUse", input)).toEqual({ kind: "allow" });
      effect();
      return send("PostToolUse", input);
    },
  };
}

const exclude = (repo: RepoFixture, line: string): void => fs.appendFileSync(path.join(repo.root, ".git/info/exclude"), `${line}\n`);
const ignore = (repo: RepoFixture, line: string): void => repo.write(".gitignore", `${repo.read(".gitignore")}${line}\n`);
const blocked = { kind: "block", findings: [{ rule: "nested-lint-config", file: NESTED }] };

describe("ignored nested lint configs are still found", () => {
  function repoWithIgnore() {
    const repo = makerkitRepo({ ".gitignore": "node_modules/\n" });
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    return { repo, hooks: session(repo) };
  }

  it("C: excluded through .git/info/exclude and written in one command", async () => {
    const { repo, hooks } = repoWithIgnore();
    await hooks.prompt();
    const command = `printf '.oxlintrc.json\\n' >> .git/info/exclude && printf '{}' > ${NESTED}`;
    const after = await hooks.shell(command, () => {
      exclude(repo, ".oxlintrc.json");
      repo.write(NESTED, "{}");
    });
    expect(after).toMatchObject(blocked);
    expect(await hooks.stop()).toMatchObject(blocked);
  });

  it("C: written in one command and excluded in the next", async () => {
    const { repo, hooks } = repoWithIgnore();
    await hooks.prompt();
    expect(await hooks.shell(`printf '{}' > ${NESTED}`, () => repo.write(NESTED, "{}"))).toMatchObject(blocked);
    expect(await hooks.shell("printf '.oxlintrc.json\\n' >> .git/info/exclude", () => exclude(repo, ".oxlintrc.json"))).toMatchObject(blocked);
    expect(await hooks.stop()).toMatchObject(blocked);
  });

  it("D: ignored through .gitignore and written in one command", async () => {
    const { repo, hooks } = repoWithIgnore();
    await hooks.prompt();
    const after = await hooks.shell(`printf '${NESTED}\\n' >> .gitignore && printf '{}' > ${NESTED}`, () => {
      ignore(repo, NESTED);
      repo.write(NESTED, "{}");
    });
    expect(after).toMatchObject(blocked);
    expect(await hooks.stop()).toMatchObject(blocked);
  });

  it("D: ignored through .gitignore first, written in a second command", async () => {
    const { repo, hooks } = repoWithIgnore();
    await hooks.prompt();
    expect(await hooks.shell(`printf '${NESTED}\\n' >> .gitignore`, () => ignore(repo, NESTED))).toEqual({ kind: "allow" });
    expect(await hooks.shell(`printf '{}' > ${NESTED}`, () => repo.write(NESTED, "{}"))).toMatchObject(blocked);
    expect(await hooks.stop()).toMatchObject(blocked);
  });

  it("finds one inside an ignored folder that holds tracked files, and skips node_modules", () => {
    const repo = makerkitRepo({ ".gitignore": "node_modules/\n" });
    ignore(repo, "packages/features/accounts/src/");
    repo.write("packages/features/accounts/src/.oxlintrc.json", "{}");
    repo.write("packages/features/accounts/node_modules/some-lib/.eslintignore", "dist\n");
    repo.write("node_modules/some-lib/.oxlintrc.json", "{}");
    expect(lintConfigFindings(repo.root, resolveHarness(repo.root)).map((finding) => finding.file)).toEqual(["packages/features/accounts/src/.oxlintrc.json"]);
  });

  it("CI reports it in the audit step", async () => {
    const repo = makerkitRepo({ ".gitignore": "node_modules/\n" });
    exclude(repo, ".oxlintrc.json");
    repo.write(NESTED, "{}");
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(repo.root);
    expect(result.findings.filter((finding) => finding.rule === "nested-lint-config").map((finding) => finding.file)).toEqual([NESTED]);
    expect(result.report).toContain("audit: failed");
  });

  it("says the root config is locked only when harness.config.ts locks it", () => {
    const repo = makerkitRepo({ "harness.config.ts": makerkitConfig().replace("  owned:", '  locked: [".oxlintrc.json"],\n  owned:') });
    expect(lintConfigReason(resolveHarness(repo.root), NESTED)).toContain("in the root .oxlintrc.json, which harness.config.ts locks.");
  });
});

describe("nested ESLint configs, which ESLint 10 reads for the files below them", () => {
  const DEEP = "apps/dashboard/src/modules/usage/eslint.config.mjs";

  it("are found in an eslint-prettier workspace even when ignored, the workspace's own config is not", async () => {
    const repo = dashboardRepo({ "apps/dashboard/eslint.config.ts": "export default [];\n" });
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    const after = await hooks.shell(`echo 'export default [];' > ${DEEP}`, () => {
      ignore(repo, "eslint.config.mjs");
      repo.write(DEEP, "export default [];\n");
    });
    expect(after).toMatchObject({ kind: "block", findings: [{ rule: "nested-lint-config", file: DEEP }] });
    const [finding] = lintConfigFindings(repo.root, resolveHarness(repo.root));
    expect(finding?.message).toBe(
      `${DEEP} would replace the workspace's ESLint config for its folder; lint rules belong in the ESLint config at apps/dashboard/, which the harness locks. Ask the user to change that config instead.`,
    );
    expect(await hooks.stop()).toMatchObject({ kind: "block" });
  });

  it("are left alone without harness.config.ts, where the template's ESLint 9 reads only its root config", () => {
    const repo = makeRepo({ "src/modules/notes/eslint.config.mjs": "export default [];\n" });
    expect(lintConfigFindings(repo.root, resolveHarness(repo.root))).toEqual([]);
  });
});
