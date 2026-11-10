import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { atLeast } from "../core/init/peers.ts";
import { ts } from "../tools/typescript.ts";

const harness = path.resolve(import.meta.dirname, "..");
const presets = path.join(harness, "presets");
const PACKAGES: readonly string[] = ["zod", "typescript", "vitest"];

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifest(dir: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
}

const peers = JSON.parse(fs.readFileSync(path.join(presets, "peers.json"), "utf8")) as Record<string, { version: string; minimum: string }>;
const PEERS = Object.keys(peers);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

function packageName(target: string): string {
  const parts = target.split("/");
  return (target.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

function outside(file: string, target: string): boolean {
  if (target.startsWith(".")) return path.relative(harness, path.resolve(path.dirname(file), target)).startsWith("..");
  if (target.startsWith("node:")) return false;
  const name = packageName(target);
  return !PACKAGES.includes(name);
}

describe("the harness as a subtree", () => {
  it("imports only its own files, Node built-ins, zod, typescript and vitest; presets load their tools from the calling workspace", () => {
    const leaks = sources(harness).flatMap((file) =>
      ts
        .preProcessFile(fs.readFileSync(file, "utf8"), true, true)
        .importedFiles.filter(({ fileName }) => outside(file, fileName))
        .map(({ fileName }) => `${path.relative(harness, file)}: ${fileName}`),
    );
    expect(leaks).toEqual([]);
  });

  it("pins each peer tool to the template's exact version", () => {
    const template = manifest(path.resolve(harness, "../..")).devDependencies ?? {};
    expect(Object.fromEntries(PEERS.map((name) => [name, template[name]]))).toEqual(Object.fromEntries(PEERS.map((name) => [name, peers[name]?.version])));
  });

  it("asks for no tool below the version the template itself runs", () => {
    for (const [name, { version, minimum }] of Object.entries(peers)) expect(atLeast(version, minimum), name).toBe(true);
    expect(atLeast("10.14.0", "9.22.0")).toBe(true);
    expect(atLeast("9.21.9", "9.22.0")).toBe(false);
    expect(atLeast("", "9.22.0")).toBe(false);
  });

  it("gives a kit's manypkg nothing to fix: no peerDependencies, and its own pins as npm: aliases of the template's versions", () => {
    const own = manifest(harness);
    expect(own.peerDependencies).toBeUndefined();
    const template = manifest(path.resolve(harness, "../.."));
    const versions = { ...template.dependencies, ...template.devDependencies };
    for (const [name, spec] of Object.entries({ ...own.dependencies, ...own.devDependencies })) expect(spec, name).toBe(`npm:${name}@${versions[name] ?? ""}`);
  });
});
