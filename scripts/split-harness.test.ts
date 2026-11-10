import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../tooling/harness/testing/temp-repo.ts";
import { splitHarness } from "./split-harness.ts";

function source() {
  const repo = makeRepo({
    "README.md": "# App\n",
    "tooling/harness/cli.ts": 'console.log("harness");\n',
    "tooling/harness/package.json": '{ "name": "@harness/core" }\n',
  });
  repo.write("tooling/harness/cli.ts", 'console.log("harness v2");\n');
  repo.write("src/app.ts", "export const app = 1;\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "Second");
  return repo;
}

describe("splitHarness", () => {
  it("points the harness branch at a history whose root holds the harness files only", () => {
    const repo = source();
    const { branch, commit } = splitHarness(repo.root);
    expect(branch).toBe("harness");
    expect(repo.git("rev-parse", "harness").trim()).toBe(commit);
    expect(repo.git("ls-tree", "--name-only", "harness").trim().split("\n")).toEqual(["cli.ts", "package.json"]);
    expect(repo.git("rev-list", "--count", "harness").trim()).toBe("2");
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });

  it("moves the branch after a new harness commit", () => {
    const repo = source();
    const first = splitHarness(repo.root).commit;
    repo.write("tooling/harness/core.ts", "export const core = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "Third");
    const second = splitHarness(repo.root).commit;
    expect(second).not.toBe(first);
    expect(repo.git("rev-parse", "harness").trim()).toBe(second);
    expect(repo.git("merge-base", "--is-ancestor", first, second)).toBe("");
    expect(splitHarness(repo.root).warning).toBeUndefined();
  });

  it("refuses while tooling/harness has uncommitted changes and leaves the branch alone", () => {
    const repo = source();
    repo.write("tooling/harness/cli.ts", 'console.log("draft");\n');
    expect(() => splitHarness(repo.root)).toThrow("Uncommitted changes under tooling/harness are not in the split; commit them first.");
    repo.git("checkout", "--", "tooling/harness/cli.ts");
    repo.write("tooling/harness/new.ts", "export const draft = 1;\n");
    expect(() => splitHarness(repo.root)).toThrow("Uncommitted changes under tooling/harness");
    expect(repo.git("branch", "--list", "harness")).toBe("");
  });

  it("warns, naming both commits, when the new split does not descend from the branch", () => {
    const repo = source();
    const previous = repo.git("rev-parse", "HEAD").trim();
    repo.git("branch", "harness", previous);
    const { commit, warning } = splitHarness(repo.root);
    expect(warning).toContain(previous);
    expect(warning).toContain(commit);
    expect(repo.git("rev-parse", "harness").trim()).toBe(commit);
  });

  it("gives a consumer the harness under tooling/harness through git subtree add", () => {
    const repo = source();
    splitHarness(repo.root);
    const consumer = makeRepo({ "README.md": "# Consumer\n" });
    consumer.git("subtree", "add", "--prefix=tooling/harness", repo.root, "harness", "--squash");
    expect(fs.readFileSync(path.join(consumer.root, "tooling/harness/cli.ts"), "utf8")).toBe('console.log("harness v2");\n');
    expect(consumer.read("tooling/harness/package.json")).toContain("@harness/core");
  });
});
