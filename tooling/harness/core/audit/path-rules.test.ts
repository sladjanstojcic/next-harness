import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { formatFindings } from "./finding.ts";
import { listFiles } from "./list-files.ts";
import { auditPaths } from "./path-rules.ts";

function sources(folder: string, count: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/file-${i}.ts`, "export {};\n"]));
}

describe("auditPaths", () => {
  it("reports folder-size on every selected source", () => {
    const repo = makeRepo(sources("src/modules/a/components", 11));
    const findings = auditPaths(repo.root, listFiles(repo.root));
    expect(findings).toHaveLength(11);
    expect(findings[0]).toMatchObject({ rule: "folder-size", message: expect.stringContaining("components/") as unknown });
  });

  it("exempts Next route special and metadata files from folder-size", () => {
    const names = [
      "layout.tsx",
      "page.tsx",
      "error.tsx",
      "global-error.tsx",
      "not-found.tsx",
      "loading.tsx",
      "sitemap.ts",
      "robots.ts",
      "manifest.ts",
      "opengraph-image.tsx",
      "icon.tsx",
    ];
    const repo = makeRepo(Object.fromEntries(names.map((name) => [`src/app/${name}`, ""])));
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("clears a folder-size violation after an unstaged deletion", () => {
    const repo = makeRepo(sources("src/modules/a/components", 11));
    repo.remove("src/modules/a/components/file-10.ts");
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("does not count colocated tests or assets toward the folder limit", () => {
    const repo = makeRepo(sources("src/modules/a/components", 10));
    for (let i = 0; i < 10; i++) repo.write(`src/modules/a/components/file-${i}.test.tsx`, "");
    repo.write("src/modules/a/components/logo.svg", "<svg />");
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("detects a duplicate basename in two modules", () => {
    const repo = makeRepo({ "src/modules/a/server/get-x.ts": "", "src/modules/b/server/get-x.ts": "" });
    expect(auditPaths(repo.root, listFiles(repo.root))).toContainEqual(
      expect.objectContaining({
        rule: "duplicate-file-name",
        file: "src/modules/b/server/get-x.ts",
        message: expect.stringContaining("src/shared/") as unknown,
      }),
    );
  });

  it("exempts vendored UI from the folder limit", () => {
    const repo = makeRepo(sources("src/shared/ui", 11));
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("exempts the vendored utility without exempting other shared lib files", () => {
    const repo = makeRepo({ ...sources("src/shared/lib", 10), "src/shared/lib/utils.ts": "" });
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
    repo.write("src/shared/lib/extra.ts", "");
    expect(auditPaths(repo.root, ["src/shared/lib/extra.ts"])).toContainEqual(expect.objectContaining({ rule: "folder-size" }));
  });

  it("uses the full inventory for a one-file folder check", () => {
    const repo = makeRepo(sources("src/modules/a/components", 10));
    const changed = "src/modules/a/components/new-file.tsx";
    repo.write(changed, "");
    expect(auditPaths(repo.root, [changed])).toEqual([
      expect.objectContaining({ rule: "folder-size", file: changed, message: expect.stringContaining("11") as unknown }),
    ]);
  });

  it("reports only the requested side of a cross-module duplicate", () => {
    const changed = "src/modules/b/server/get-x.ts";
    const repo = makeRepo({ "src/modules/a/server/get-x.ts": "", [changed]: "" });
    expect(auditPaths(repo.root, [changed])).toEqual([
      expect.objectContaining({ rule: "duplicate-file-name", file: changed, message: expect.stringContaining("src/modules/a/server/get-x.ts") as unknown }),
    ]);
  });

  it("does not report unrelated inventory violations during a one-file check", () => {
    const repo = makeRepo({
      ...sources("src/modules/a/components", 11),
      "src/modules/a/server/get-x.ts": "",
      "src/modules/b/server/get-x.ts": "",
      "lib/bad.ts": "",
      "src/shared/lib/good.ts": "",
    });
    expect(auditPaths(repo.root, ["src/shared/lib/good.ts"])).toEqual([]);
  });

  it("exempts conventional module names and tests from duplicate detection", () => {
    const repo = makeRepo();
    for (const moduleName of ["a", "b"]) {
      for (const file of ["index.ts", "server.ts", "schemas.ts", "types.ts", "domain/total.test.ts", "components/row.test.tsx"]) {
        repo.write(`src/modules/${moduleName}/${file}`, "");
      }
    }
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("does not treat equal basenames inside one module as cross-module duplicates", () => {
    const repo = makeRepo({ "src/modules/a/components/get-x.ts": "", "src/modules/a/server/get-x.ts": "" });
    expect(auditPaths(repo.root, listFiles(repo.root))).toEqual([]);
  });

  it("applies folder limits to the harness too", () => {
    const repo = makeRepo(sources("tooling/harness/audit", 11));
    expect(auditPaths(repo.root, ["tooling/harness/audit/file-0.ts"])).toEqual([
      expect.objectContaining({ rule: "folder-size", message: expect.stringContaining("tooling/") as unknown }),
    ]);
  });

  it("turns a path denial into a finding with relocation advice", () => {
    const repo = makeRepo();
    expect(auditPaths(repo.root, ["src/utils/x.ts"])).toEqual([
      { rule: "src-shape", file: "src/utils/x.ts", message: expect.stringContaining("src/shared/lib/") as unknown },
    ]);
  });
});

describe("listFiles", () => {
  it("omits an unstaged deletion while including its untracked replacement", () => {
    const repo = makeRepo({ "src/old.ts": "source" });
    repo.remove("src/old.ts");
    repo.write("src/new.ts", "source");
    expect(listFiles(repo.root)).toEqual(["src/new.ts"]);
  });

  it("returns sorted tracked and untracked paths, preserving spaces and excluding ignored files", () => {
    const repo = makeRepo({ ".gitignore": "ignored/\n", "src/z.ts": "", "src/space name.ts": "" });
    repo.write("src/a.ts", "");
    repo.write("src/z.ts", "changed");
    repo.write("ignored/no.ts", "");
    expect(listFiles(repo.root)).toEqual([".gitignore", "src/a.ts", "src/space name.ts", "src/z.ts"]);
  });

  it("preserves literal filenames that git normally quotes", () => {
    const repo = makeRepo({ 'src/quote".ts': "", "src/line\nbreak.ts": "", "src/č.ts": "" });
    expect(listFiles(repo.root)).toEqual(["src/line\nbreak.ts", 'src/quote".ts', "src/č.ts"]);
  });
});

describe("formatFindings", () => {
  it("formats one finding per line with a usable default location", () => {
    expect(
      formatFindings([
        { rule: "app-file", file: "src/app/x.tsx", line: 7, message: "Move to components/." },
        { rule: "file-name", file: "scripts/Bad.ts", message: "Use scripts/bad.ts." },
      ]),
    ).toBe("src/app/x.tsx:7 app-file — Move to components/.\nscripts/Bad.ts:1 file-name — Use scripts/bad.ts.");
    expect(formatFindings([])).toBe("");
  });
});

describe("makeRepo", () => {
  let parent: string | undefined;
  afterAll(() => {
    if (parent) expect(existsSync(parent)).toBe(false);
    parent = undefined;
  });

  it("clears inherited Git repository variables on import without committing into another repo", async () => {
    const other = makeRepo({ "protected.ts": "original" });
    const log = other.git("log", "--format=%H");
    try {
      vi.stubEnv("GIT_DIR", `${other.root}/.git`);
      vi.resetModules();
      await import("../../testing/temp-repo.ts");
      const repo = makeRepo({ "src/fixture.ts": "fixture" });
      expect(other.git("log", "--format=%H")).toBe(log);
      expect(listFiles(repo.root)).toEqual(["src/fixture.ts"]);
      expect(other.git("status", "--porcelain")).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("isolates git and filesystem operations in a disposable parent with a space", () => {
    const repo = makeRepo({ "src/initial.ts": "initial" });
    parent = dirname(repo.root);
    expect(parent).toContain(" ");
    expect(repo.read("src/initial.ts")).toBe("initial");
    repo.write("src/nested/new.ts", "new");
    expect(repo.read("src/nested/new.ts")).toBe("new");
    repo.remove("src/nested/new.ts");
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(repo.git("config", "core.hooksPath").trim()).toBe(`${parent}/no-hooks`);
    expect(() => repo.write("../escape.ts", "no")).toThrow("escapes the repository");
  });
});
