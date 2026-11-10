import fs from "node:fs";
import path from "node:path";
import { makeRepo } from "./temp-repo.ts";

const template = path.resolve(import.meta.dirname, "../../..");

/** Template-relative paths of every file under a template folder. */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(path.join(template, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

export function templateRepo(files: Record<string, string> = {}) {
  const configs = [
    "package.json",
    "tsconfig.json",
    "eslint.config.ts",
    "prettier.config.ts",
    "src/shared/lib/utils.ts",
    "knip.config.ts",
    "vitest.config.ts",
    ".dependency-cruiser.json",
    ".jscpd.json",
    ".gitignore",
    "tooling/harness/shapes/limits.ts",
    ...filesUnder("tooling/harness/presets"),
  ];
  const repo = makeRepo({
    ...Object.fromEntries(configs.map((file) => [file, fs.readFileSync(path.join(template, file), "utf8")])),
    "src/app/page.tsx": "export default function Page() { return <main>Hello</main>; }\n",
    "src/app/layout.tsx": "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
    ...files,
  });
  fs.symlinkSync(path.join(template, "node_modules"), path.join(repo.root, "node_modules"), "dir");
  return repo;
}

/** A project before init: the harness presets with the limits they read, the template's node_modules, no tool configs and no git hooks path. */
export function consumerRepo(files: Record<string, string>) {
  const harness = ["tooling/harness/shapes/limits.ts", ...filesUnder("tooling/harness/presets")];
  const repo = makeRepo({ ...Object.fromEntries(harness.map((file) => [file, fs.readFileSync(path.join(template, file), "utf8")])), ...files });
  repo.git("config", "--unset", "core.hooksPath");
  fs.symlinkSync(path.join(template, "node_modules"), path.join(repo.root, "node_modules"), "dir");
  return repo;
}
