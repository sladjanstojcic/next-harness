import { describe, expect, it } from "vitest";
import { auditTsconfigs } from "../core/audit/tsconfig-rules.ts";
import { prettierIgnored } from "../core/init/ignore-files.ts";
import { toolConfigSteps } from "../core/init/tool-configs.ts";
import { isLocked } from "../core/lock.ts";
import { makeRepo } from "./temp-repo.ts";

const API = { path: "apps/api", shape: "node-service", tools: "eslint-prettier", next: false } as const;
const CONFIG = 'export default { workspaces: [{ path: "apps/api", shape: "node-service" }], root: { entries: ["apps"] } };\n';
/** Node's recommended options for running TypeScript, as the shape requires them. */
const NODE_OPTIONS = {
  strict: true,
  module: "nodenext",
  noEmit: true,
  allowImportingTsExtensions: true,
  erasableSyntaxOnly: true,
  verbatimModuleSyntax: true,
};
const findings = (options: Record<string, unknown>): string[] =>
  auditTsconfigs(makeRepo({ "harness.config.ts": CONFIG, "apps/api/tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"] }) }).root).map(
    ({ rule, file, message }) => `${rule} ${file} ${message.split(" ")[0] ?? ""}`,
  );

describe("the tsconfig of a node-service workspace", () => {
  it("passes Node's options for running TypeScript", () => {
    expect(findings(NODE_OPTIONS)).toEqual([]);
  });

  it("asks for each option Node needs, and against paths, which Node does not apply", () => {
    expect(findings({ ...NODE_OPTIONS, allowImportingTsExtensions: false })).toEqual(["tsconfig-node apps/api/tsconfig.json compilerOptions.allowImportingTsExtensions"]);
    expect(findings({ ...NODE_OPTIONS, module: "esnext" })).toEqual(["tsconfig-node apps/api/tsconfig.json compilerOptions.module"]);
    expect(findings({ ...NODE_OPTIONS, paths: { "@/*": ["./src/*"] } })).toEqual(["tsconfig-node apps/api/tsconfig.json compilerOptions.paths"]);
    expect(findings({ strict: true })).toHaveLength(5);
  });

  it("still asks for strict", () => {
    expect(findings({ ...NODE_OPTIONS, strict: false })).toEqual(["tsconfig-strict apps/api/tsconfig.json compilerOptions.strict"]);
  });
});

describe("the lock and the ignore files of a node-service workspace", () => {
  const config = { workspaces: [{ path: "apps/api", shape: "node-service" as const }] };

  it("locks every tsconfig*.json, and leaves the Dockerfile open", () => {
    expect(isLocked("apps/api/tsconfig.json", config)).toBe(true);
    expect(isLocked("apps/api/tsconfig.build.json", config)).toBe(true);
    expect(isLocked("apps/api/Dockerfile", config)).toBe(false);
    expect(isLocked("apps/api/tsconfig.build.json", { workspaces: [{ path: "apps/api", shape: "package" as const }] })).toBe(false);
  });

  it("keeps tsc's build info out of git and the generated types out of the format check", () => {
    const repo = makeRepo({ "apps/api/package.json": "{}\n" });
    expect(toolConfigSteps(repo.root, API, false, false).find(({ target }) => target === "apps/api/.gitignore")?.detail).toBe("*.tsbuildinfo");
    expect(prettierIgnored(API)).toEqual(["pnpm-lock.yaml", "src/backend/*.types.ts", "src/backend/*-types.ts"]);
  });
});
