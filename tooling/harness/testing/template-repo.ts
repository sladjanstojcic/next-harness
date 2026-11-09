import fs from "node:fs";
import path from "node:path";
import { makeRepo } from "./temp-repo.ts";

const template = path.resolve(import.meta.dirname, "../../..");
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
