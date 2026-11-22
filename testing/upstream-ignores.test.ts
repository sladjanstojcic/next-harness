import { describe, expect, it } from "vitest";
import { initHarness } from "../core/init/init.ts";
import { upstreamIn } from "../core/upstream.ts";
import { PLAYWRIGHT_OUTPUT } from "../presets/e2e.ts";
import { run } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";

const E2E = "apps/e2e";
const LIST = "tooling/harness-upstream.json";
const config = (upstream: boolean): string =>
  `export default { workspaces: [{ path: "${E2E}", shape: "e2e" }], root: { entries: ["apps"] }${upstream ? `, upstream: "${LIST}"` : ""} };\n`;
const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM"], module: "esnext", moduleResolution: "bundler", strict: true, noEmit: true },
  include: ["tests"],
});

/** Unformatted code with a console call, which the e2e layout reports and Prettier rewrites. */
const LOGGING = 'import { test } from "@playwright/test";\n\ntest("b", () => {\n  console.log( 1 )\n});\n';
/** The kit's files, one in a folder whose name is a glob pattern; the sibling owned file has the same code. */
const KIT = ["tests/invitations.spec.ts", "tests/[locale]/mailbox.spec.ts"];
const OWN = "tests/orders.spec.ts";

function project(upstream: boolean) {
  const repo = consumerRepo({
    "package.json": "{}\n",
    "harness.config.ts": config(upstream),
    ...(upstream ? { [LIST]: `${JSON.stringify({ version: 1, files: KIT.map((file) => `${E2E}/${file}`) })}\n` } : {}),
    [`${E2E}/package.json`]: JSON.stringify({ name: "e2e", type: "module" }),
    [`${E2E}/tsconfig.json`]: TSCONFIG,
    ...Object.fromEntries([...KIT, OWN].map((file) => [`${E2E}/${file}`, LOGGING])),
  });
  const result = initHarness(repo.root, { force: false, starter: false });
  expect(result.ok, result.report).toBe(true);
  return repo;
}

interface Result {
  filePath: string;
  messages: { ruleId: string | null }[];
}

/** The rule ids ESLint reports per file, through the workspace's own config, as the check gate runs it. */
function linted(root: string): Record<string, string[]> {
  const results = JSON.parse(run(`${root}/${E2E}`, "eslint", ["-f", "json", "."]).output) as Result[];
  return Object.fromEntries(
    results
      .filter(({ messages }) => messages.length > 0)
      .map(({ filePath, messages }) => [filePath.slice(filePath.indexOf("tests/")), messages.map(({ ruleId }) => ruleId ?? "")]),
  );
}

const unformatted = (root: string): string[] =>
  run(`${root}/${E2E}`, "prettier", ["--list-different", "."])
    .output.split("\n")
    .filter((line) => line.startsWith("tests/"));

describe("a workspace's ESLint and Prettier skip the kit's files on the upstream list", () => {
  it("lists the kit's files of the workspace, relative to it, and none without an upstream list", () => {
    expect(upstreamIn(project(true).root, E2E)).toEqual([...KIT].sort());
    expect(upstreamIn(project(false).root, E2E)).toEqual([]);
  }, 60_000);

  it("ignores the kit's files in both tools and still judges the owned sibling", () => {
    const { root, read } = project(true);
    expect(read(`${E2E}/.prettierignore`)).toBe(`${PLAYWRIGHT_OUTPUT.join("\n")}\n/tests/\\[locale\\]/mailbox.spec.ts\n/tests/invitations.spec.ts\n`);
    expect(Object.keys(linted(root))).toEqual([OWN]);
    expect(unformatted(root)).toEqual([OWN]);
  }, 120_000);

  it("judges every file as before without an upstream list", () => {
    const { root, read } = project(false);
    expect(read(`${E2E}/.prettierignore`)).toBe(`${PLAYWRIGHT_OUTPUT.join("\n")}\n`);
    expect(Object.keys(linted(root)).sort()).toEqual([...KIT, OWN].sort());
    expect(unformatted(root).sort()).toEqual([...KIT, OWN].sort());
  }, 120_000);
});
