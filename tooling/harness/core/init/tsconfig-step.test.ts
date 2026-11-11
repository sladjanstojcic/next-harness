import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { tsconfigStep, tsconfigSteps } from "./tsconfig-step.ts";

const APP = { path: "", shape: "next-modules", tools: "eslint-prettier", next: true } as const;
const step = (files: Record<string, string>, workspace: Parameters<typeof tsconfigStep>[1] = APP) => {
  const repo = makeRepo(files);
  const result = tsconfigStep(repo.root, workspace, false, []);
  result.apply?.();
  return { ...result, written: JSON.parse(repo.read(`${workspace.path === "" ? "" : `${workspace.path}/`}tsconfig.json`)) as { compilerOptions: object } };
};

describe("the @/* alias in a next-modules workspace's tsconfig.json", () => {
  it("is added on the source root when the tsconfig and what it extends map none", () => {
    const base = { "config/base.json": '{ "compilerOptions": { "strict": true } }\n', "tsconfig.json": '{ "extends": "./config/base.json" }\n' };
    const withSrc = step(base);
    expect(withSrc.detail).toContain('compilerOptions.paths "@/*": ["./src/*"]');
    expect(withSrc.written.compilerOptions).toEqual({ allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] } });
    const atTop = step(base, { ...APP, sourceRoot: "" });
    expect(atTop.written.compilerOptions).toEqual({ allowImportingTsExtensions: true, paths: { "@/*": ["./*"] } });
    const unresolved = step({ "tsconfig.json": '{ "extends": "@repo/typescript-config/nextjs.json" }\n' }, { ...APP, sourceRoot: "" });
    expect(unresolved.written.compilerOptions).toEqual({ allowImportingTsExtensions: true, paths: { "@/*": ["./*"] } });
  });

  it("joins the paths the tsconfig already has, and is left alone where it or a file it extends maps the alias", () => {
    const own = step({ "tsconfig.json": '{ "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }\n' });
    expect(own.written.compilerOptions).toMatchObject({ paths: { "~/*": ["./lib/*"], "@/*": ["./src/*"] } });
    const mapped = step({
      "tsconfig.json":
        '{ "compilerOptions": { "allowImportingTsExtensions": true, "paths": { "@/*": ["./app/*"] } }, "exclude": ["node_modules", "tooling/harness"] }\n',
    });
    expect(mapped).toMatchObject({ status: "unchanged" });
    const inherited = step({ "base.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n', "tsconfig.json": '{ "extends": "./base.json" }\n' });
    expect(inherited.detail).not.toContain("paths");
  });

  it("asks for it by hand where a file the tsconfig extends sets other paths, which a write here would replace", () => {
    const result = step({ "base.json": '{ "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }\n', "tsconfig.json": '{ "extends": "./base.json" }\n' });
    expect(result).toMatchObject({ status: "updated", todo: true });
    expect(result.detail).toContain('it extends other paths, so add this one to them by hand:\n    "compilerOptions": { "paths": { "@/*": ["./src/*"] } }');
    expect(result.written.compilerOptions).toEqual({ allowImportingTsExtensions: true });
  });

  it("is not added in a package, which has no alias", () => {
    const result = step({ "packages/ui/tsconfig.json": "{}\n" }, { path: "packages/ui", shape: "package", tools: "eslint-prettier", next: false });
    expect(result.written.compilerOptions).toEqual({ allowImportingTsExtensions: true });
  });

  it("is not written where a baseUrl other than the tsconfig's folder is in force: paths resolve against it", () => {
    const absolute = step({ "tsconfig.json": '{ "compilerOptions": { "baseUrl": "src" } }\n' });
    expect(absolute).toMatchObject({ status: "updated", todo: true });
    expect(absolute.written.compilerOptions).toEqual({ baseUrl: "src", allowImportingTsExtensions: true });
    expect(absolute.detail).toContain(
      'its baseUrl is src, and paths resolve against it, so add this one by hand:\n    "compilerOptions": { "paths": { "@/*": ["./*"] } }',
    );
    const inherited = step({ "base.json": '{ "compilerOptions": { "baseUrl": "./lib" } }\n', "tsconfig.json": '{ "extends": "./base.json" }\n' });
    expect(inherited.detail).toContain('"@/*": ["../src/*"]');
    const same = step({ "tsconfig.json": '{ "compilerOptions": { "baseUrl": "." } }\n' });
    expect(same.written.compilerOptions).toEqual({ baseUrl: ".", allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] } });
  });
});

describe("a workspace type-checked project by project (electron-vite)", () => {
  const DESK = { path: "", shape: "electron-vite", tools: "eslint-prettier", next: false } as const;
  const files = {
    "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }\n',
    "tsconfig.node.json": '{ "compilerOptions": { "composite": true, "strict": true }, "include": ["*.config.ts", "src/main/**/*.ts"] }\n',
    "tsconfig.web.json": '{ "compilerOptions": { "composite": true, "strict": true }, "include": ["src/renderer/src/**/*.ts"] }\n',
    "electron.vite.config.ts": "export default {};\n",
  };

  it("adds scripts/ and e2e/ to the project that reads the workspace's top, so their first file needs no locked edit", () => {
    const repo = makeRepo(files);
    const steps = tsconfigSteps(repo.root, DESK, false, ["eslint.config.ts"]);
    expect(steps.map((step) => `${step.status} ${step.target}: ${step.detail}`)).toEqual([
      "updated tsconfig.node.json: include scripts/**/*.ts, e2e/**/*.ts, exclude tooling/harness, harness.config.ts, eslint.config.ts",
    ]);
    for (const step of steps) step.apply?.();
    expect(JSON.parse(repo.read("tsconfig.node.json"))).toMatchObject({ include: ["*.config.ts", "src/main/**/*.ts", "scripts/**/*.ts", "e2e/**/*.ts"] });
    expect(JSON.parse(repo.read("tsconfig.web.json"))).toEqual({ compilerOptions: { composite: true, strict: true }, include: ["src/renderer/src/**/*.ts"] });
    expect(tsconfigSteps(repo.root, DESK, false, ["eslint.config.ts"]).map((step) => step.status)).toEqual(["unchanged"]);
  });
});
