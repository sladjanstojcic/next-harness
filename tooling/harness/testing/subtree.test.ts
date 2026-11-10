import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ts } from "../tools/typescript.ts";

const harness = path.resolve(import.meta.dirname, "..");
const presets = path.join(harness, "presets");
const PACKAGES: readonly string[] = ["zod", "typescript", "vitest"];

interface Manifest {
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifest(dir: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
}

const PEERS = Object.keys(manifest(harness).peerDependencies ?? {});

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
  return !PACKAGES.includes(name) && !(file.startsWith(`${presets}${path.sep}`) && PEERS.includes(name));
}

describe("the harness as a subtree", () => {
  it("imports only its own files, Node built-ins, zod, typescript and vitest; presets also import their peer tools", () => {
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
    const peers = manifest(harness).peerDependencies ?? {};
    expect(Object.fromEntries(PEERS.map((name) => [name, template[name]]))).toEqual(peers);
  });
});
