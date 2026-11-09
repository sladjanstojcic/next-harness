import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { audit, auditChanged } from "./audit.ts";
import { auditContent } from "./content-rules.ts";

function rules(file: string, source: string, extra: Record<string, string> = {}): string[] {
  const repo = makeRepo({ [file]: source, ...extra });
  return auditContent(repo.root, [file]).map((finding) => finding.rule);
}

describe("auditContent", () => {
  it.each(["src/modules/a/server.ts", "src/modules/a/server/get-a.ts"])("requires server-only in %s", (file) => {
    expect(rules(file, "export const value = 1;")).toEqual(["server-only"]);
    expect(rules(file, 'import "server-only";')).toEqual([]);
    expect(rules(file, '// import "server-only";')).toEqual(["server-only"]);
  });

  it.each(["src/modules/a/server/get-a.test.ts", "src/modules/a/server/get-a.test.tsx"])("does not require server-only in colocated tests: %s", (file) => {
    expect(rules(file, "export {};")).toEqual([]);
    expect(rules(file, "Date.now();")).toEqual(["test-determinism"]);
  });

  it.each([
    ['"use server"; export const save = defineAction(schema, handler);', []],
    ['"use server"; export async function save() {}', ["use-server-placement"]],
    ["export const save = defineAction(schema, handler);", ["use-server-placement"]],
    ['import "server-only"; "use server"; defineAction(schema, handler);', ["use-server-placement"]],
    ['"use server"; // defineAction(schema, handler)', ["use-server-placement"]],
  ])("requires a leading directive and a real defineAction call: %s", (source, expected) => {
    expect(rules("src/modules/a/actions/save-a-action.ts", source)).toEqual(expected);
  });

  it.each([
    ["src/modules/a/server/save-a.ts", 'import "server-only"; "use server";'],
    ["src/modules/a/components/x.tsx", 'export async function save() { "use server"; }'],
    ["src/app/page.tsx", '"use server";'],
  ])("rejects use server outside action entry points: %s", (file, source) => {
    expect(rules(file, source)).toEqual(["use-server-placement"]);
  });

  it.each(["./server", "./server.ts", "./server/get-a", "./actions", "./actions/save-a-action"])("keeps index.ts client-safe: %s", (target) => {
    for (const statement of [`import { a } from "${target}";`, `export { a } from "${target}";`]) {
      expect(rules("src/modules/a/index.ts", statement)).toEqual(["index-exports"]);
    }
  });

  it("permits the component public API and ignores directives in comments/strings", () => {
    expect(rules("src/modules/a/index.ts", 'export { A } from "./components/a-list";')).toEqual([]);
    expect(rules("src/shared/lib/text.ts", '// "use client";\nexport const example = \'"use server";\';')).toEqual([]);
  });

  it.each([
    "src/modules/a/components/x.tsx",
    "src/shared/components/x.tsx",
    "src/shared/hooks/use-x.ts",
    "src/shared/ui/button.tsx",
    "src/app/error.tsx",
    "src/app/orders/error.tsx",
    "src/app/global-error.tsx",
  ])("allows client directives in %s", (file) => {
    expect(rules(file, '"use client";')).toEqual([]);
  });

  it.each(["src/modules/a/server/x.ts", "src/shared/lib/x.ts", "src/app/page.tsx"])("rejects client directives in %s", (file) => {
    expect(rules(file, '"use client"; import "server-only";')).toEqual(["use-client-placement"]);
  });

  it.each(["@/modules/b/server", "@/modules/b/server.ts", "@/modules/b/server/get-b", "../server", "../server.ts", "../server/get-a"])(
    "rejects a client import from %s",
    (target) => {
      expect(rules("src/modules/a/components/x.tsx", `"use client"; import { a } from "${target}";`)).toEqual(["client-imports-server"]);
    },
  );

  it.each(["@/modules/b", "@/modules/b/actions/save-b-action", "../actions/save-a-action"])("allows a client import from %s", (target) => {
    expect(rules("src/modules/a/components/x.tsx", `"use client"; import { a } from "${target}";`)).toEqual([]);
  });

  it("centralizes environment reads, without flagging harness code or comments", () => {
    expect(rules("src/modules/a/server/x.ts", 'import "server-only"; process.env.X;')).toEqual(["env-access"]);
    expect(rules("src/shared/lib/env.ts", "process.env.X;")).toEqual([]);
    expect(rules("tooling/harness/example.ts", "process.env.X;")).toEqual([]);
    expect(rules("src/shared/lib/example.ts", '// process.env.X\nexport const text = "process.env.X";')).toEqual([]);
  });

  it("counts blank lines and comments at the thin-page boundary", () => {
    expect(rules("src/app/page.tsx", Array(61).fill("// line").join("\n"))).toEqual(["thin-page"]);
    expect(rules("src/app/page.tsx", Array(60).fill("// line").join("\n") + "\n")).toEqual([]);
  });

  it("requires a domain test on disk even when auditing only the source", () => {
    const file = "src/modules/a/domain/total.ts";
    expect(rules(file, "export const total = 1;")).toEqual(["domain-test"]);
    expect(rules(file, "export const total = 1;", { "src/modules/a/domain/total.test.ts": "" })).toEqual([]);
    expect(rules("src/modules/a/domain/total.test.ts", "")).toEqual([]);
  });

  it("requires a domain test inside an area subfolder", () => {
    const file = "src/modules/a/domain/pricing/total.ts";
    expect(rules(file, "export const total = 1;")).toEqual(["domain-test"]);
    expect(rules(file, "export const total = 1;", { "src/modules/a/domain/pricing/total.test.ts": "" })).toEqual([]);
  });

  it.each(["error.message", "err.stack", "String(error)", "String(err)", "String(e)"])("rejects raw UI error text: %s", (expression) => {
    expect(rules("src/modules/a/components/x.tsx", `export const View = () => <p>{${expression}}</p>;`)).toEqual(["error-text"]);
    expect(rules("src/app/error.tsx", `export const View = () => <p>{${expression}}</p>;`)).toEqual(["error-text"]);
    expect(rules("src/shared/lib/log.ts", `${expression};`)).toEqual([]);
  });

  it.each(["fieldState.error?.message", "issue.message", "notification.message", "chat.message", "layout.stack"])(
    "allows ordinary UI properties: %s",
    (expression) => {
      expect(rules("src/shared/components/view.tsx", `export const View = () => <p>{${expression}}</p>;`)).toEqual([]);
    },
  );

  it.each(["failure.message", "failure['stack']", "String(failure)"])("rejects catch-bound UI errors: %s", (expression) => {
    expect(rules("src/shared/components/view.tsx", `try { work(); } catch (failure) { show(${expression}); }`)).toEqual(["error-text"]);
  });

  it("limits catch names to their catch scope", () => {
    expect(rules("src/shared/components/view.tsx", "try { work(); } catch (failure) { log(failure); } notification.message; failure.message;")).toEqual([]);
  });

  it("allows raw error assertions in UI test files", () => {
    expect(rules("src/shared/components/view.test.tsx", "expect(error.message).toBe('failure'); expect(err.stack).toBeDefined();")).toEqual([]);
  });

  it.each(["Date.now()", "Math.random()", "new Date()", 'fetch("https://example.invalid")'])("detects nondeterminism: %s", (expression) => {
    expect(rules("tooling/harness/sample.test.ts", expression)).toEqual(["test-determinism"]);
    expect(rules("tooling/harness/sample.test.ts", `vi.useFakeTimers(); ${expression}`)).toEqual([]);
  });

  it.each(["useFakeTimers", "setSystemTime", "mock.timers", "mockImplementation", "seed(", "fc.assert", "fc.property"])(
    "honors the ported seed marker %s",
    (marker) => {
      expect(rules("src/shared/lib/example.test.ts", `// ${marker}\nDate.now();`)).toEqual([]);
    },
  );

  it("allows fixed dates and ignores nondeterministic text in fixtures", () => {
    expect(rules("tooling/harness/example.test.ts", 'new Date("2026-01-01"); const example = "Date.now()"; // Math.random()')).toEqual([]);
    expect(rules("tooling/harness/example.test.ts", "// FIXTURE_ANCHOR\nDate.now();")).toEqual(["test-determinism"]);
  });

  it("reports source lines and gives a destination", () => {
    const file = "src/shared/components/error-view.tsx";
    const repo = makeRepo({ [file]: "\n\nString(error);" });
    expect(auditContent(repo.root, [file])).toEqual([{ file, line: 3, rule: "error-text", message: expect.stringContaining("src/shared/lib/") as unknown }]);
  });
});

describe("audit", () => {
  it("combines path and content rules, skipping vendored files and non-code assets", () => {
    const repo = makeRepo({
      "src/utils/bad.ts": "process.env.X;",
      "src/shared/ui/Bad.tsx": '"use server"; process.env.X;',
      "src/shared/lib/utils.ts": "process.env.X;",
      "public/logo.svg": '<svg>"use server";</svg>',
    });
    expect(audit(repo.root).map(({ rule }) => rule)).toEqual(["src-shape", "env-access"]);
    expect(auditChanged(repo.root, ["public/logo.svg"])).toEqual([]);
  });
});
