import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ShapeName, WorkspaceEntry } from "../../../config.ts";
import { makeRepo } from "../../../testing/temp-repo.ts";
import { consumerRepo } from "../../../testing/template-repo.ts";
import { initHarness } from "../init.ts";
import { shadcnTodo } from "./shadcn-steps.ts";

const fixture = (name: string): Record<string, string> =>
  z.record(z.string(), z.string()).parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../../testing/fixtures", name), "utf8")));
const at = (folder: string, files: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([file, text]) => [`${folder}/${file}`, text]));
const entry = (shape: ShapeName, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  path: "apps/web",
  shape,
  tools: "eslint-prettier",
  next: shape === "next-modules",
  ...extra,
});

const NEXT = { "apps/web/package.json": '{ "name": "web" }\n', "apps/web/tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n' };
const NEXT_TAILWIND = { ...NEXT, "apps/web/package.json": '{ "name": "web", "devDependencies": { "tailwindcss": "4.3.3" } }\n' };
const VITE = at("apps/web", fixture("create-vite-9.3.4.json"));
const ELECTRON = at("apps/web", fixture("electron-vite-scaffold.json"));

const aliases = (prefix: string): string =>
  `{ "components": "${prefix}shared/components", "utils": "${prefix}shared/lib/utils", "ui": "${prefix}shared/ui", "lib": "${prefix}shared/lib", "hooks": "${prefix}shared/hooks" }`;
const SETUP = "Set up shadcn, whose components the lint rule then asks for (init does not run it)";
const tailwind = (css: string, plugins: string): string =>
  `Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in apps/web/${css}, add tailwindcss() from "@tailwindcss/vite" to the ${plugins}, and run (cd apps/web && pnpm add -D tailwindcss @tailwindcss/vite)`;
const nextTailwind = (css: string, config: string): string =>
  `Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in apps/web/${css}, add turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } } to the config in apps/web/${config}, and run (cd apps/web && pnpm add -D tailwindcss @tailwindcss/turbopack)`;
const remove = (source: string, next = false): string =>
  `Delete the two files shadcn init wrote where the layout takes no code${next ? `, and where its font setup imported cn from "@/lib/utils" in apps/web/${source}app/layout.tsx, import it from "@/shared/lib/utils"` : ""}: rm apps/web/${source}components/ui/button.tsx apps/web/${source}lib/utils.ts`;
const point = (source: string, prefix: string): string =>
  `Point shadcn at apps/web/${source}shared/, by setting "aliases" in apps/web/components.json to: ${aliases(prefix)}`;
const ADD = "Add the first component and the cn helper there: (cd apps/web && pnpm dlx shadcn@latest add button utils)";

describe("the shadcn setup init prints", () => {
  it("sets up a Next workspace in src/ or at its top, with paths from the repository root", () => {
    for (const [sourceRoot, source] of [
      [undefined, "src/"],
      ["", ""],
    ] as const) {
      const repo = makeRepo(NEXT_TAILWIND);
      expect(shadcnTodo(repo.root, [entry("next-modules", sourceRoot === undefined ? {} : { sourceRoot })])).toEqual([
        `${SETUP}: (cd apps/web && pnpm dlx shadcn@latest init -t next -b base -p nova)`,
        remove(source, true),
        point(source, "@/"),
        ADD,
      ]);
    }
  });

  it("adds Tailwind first in a Next workspace without it, through the Turbopack loader in its own Next config", () => {
    expect(shadcnTodo(makeRepo(NEXT).root, [entry("next-modules")])[0]).toBe(nextTailwind("src/app/globals.css", "next.config.ts"));
    const turbo = makeRepo({ ...NEXT, "apps/web/next.config.js": "export default {};\n" });
    expect(shadcnTodo(turbo.root, [entry("next-modules", { sourceRoot: "" })])[0]).toBe(nextTailwind("app/globals.css", "next.config.js"));
  });

  it("adds Tailwind first in a create-vite workspace", () => {
    const repo = makeRepo(VITE);
    expect(shadcnTodo(repo.root, [entry("vite-spa")])).toEqual([
      tailwind("src/index.css", "plugins in apps/web/vite.config.ts"),
      `${SETUP}: (cd apps/web && pnpm dlx shadcn@latest init -t vite -b base -p nova)`,
      remove("src/"),
      point("src/", "@/"),
      ADD,
    ]);
    repo.write("apps/web/package.json", '{ "devDependencies": { "tailwindcss": "4.3.5" } }\n');
    expect(shadcnTodo(repo.root, [entry("vite-spa")])[0]).toBe(`${SETUP}: (cd apps/web && pnpm dlx shadcn@latest init -t vite -b base -p nova)`);
  });

  it("gives shadcn the renderer alias in the root tsconfig and a Vite config for its run, in an electron-vite workspace", () => {
    const repo = makeRepo(ELECTRON);
    expect(shadcnTodo(repo.root, [entry("electron-vite")])).toEqual([
      tailwind("src/renderer/src/assets/main.css", "renderer plugins in apps/web/electron.vite.config.ts"),
      'Map @renderer/ in apps/web/tsconfig.json too, where shadcn reads aliases (init does not edit it): add "compilerOptions": { "paths": { "@renderer/*": ["./src/renderer/src/*"] } }',
      `${SETUP}; it recognises Vite only by a vite.config file, so the command gives it an empty one for the run: (cd apps/web && printf 'export default {}\\n' > vite.config.ts && pnpm dlx shadcn@latest init -t vite -b base -p nova && rm vite.config.ts)`,
      remove("src/renderer/src/"),
      point("src/renderer/src/", "@renderer/"),
      "Add the first component and the cn helper there, and format what shadcn wrote in the project's own style: (cd apps/web && pnpm dlx shadcn@latest add button utils && pnpm exec prettier --write src/renderer/src/assets/main.css src/renderer/src/shared/lib/utils.ts)",
    ]);
  });

  it("prints nothing for a workspace with components.json, or of a shape without React app code of its own", () => {
    const repo = makeRepo({ ...NEXT, ...VITE, "apps/web/components.json": "{}\n" });
    expect(shadcnTodo(repo.root, [entry("next-modules"), entry("vite-spa"), entry("electron-vite")])).toEqual([]);
    const shapes: ShapeName[] = ["makerkit-app", "makerkit-feature", "package", "supabase", "e2e"];
    expect(
      shadcnTodo(
        makeRepo(NEXT).root,
        shapes.map((shape) => entry(shape)),
      ),
    ).toEqual([]);
  });

  it("prints nothing once a commit holds the workspace as a harness workspace, and again for a new one below the root", () => {
    const repo = makeRepo({ ".githooks/pre-push": "#!/bin/sh\n", ...NEXT_TAILWIND });
    expect(shadcnTodo(repo.root, [entry("next-modules")])).toEqual([]);
    for (const [file, text] of Object.entries(NEXT_TAILWIND)) repo.write(file.replace("apps/web", "apps/docs"), text);
    expect(shadcnTodo(repo.root, [entry("next-modules", { path: "apps/docs" })])[0]).toBe(
      `${SETUP}: (cd apps/docs && pnpm dlx shadcn@latest init -t next -b base -p nova)`,
    );
  });

  it("comes before the commit in init's numbered steps, after the alias it needs", () => {
    const repo = consumerRepo({
      ...fixture("create-vite-9.3.4.json"),
      "harness.config.ts": 'export default {\n  workspaces: [{ path: ".", shape: "vite-spa" }],\n};\n',
    });
    const { report, ok } = initHarness(repo.root, { force: false, starter: false });
    expect(ok, report).toBe(true);
    const index = (start: string): number => report.split("\n").findIndex((line) => line.replace(/^ +\d+\. /, "").startsWith(start));
    expect(index("Map @/ to src/")).toBeGreaterThan(-1);
    expect(index("Map @/ to src/")).toBeLessThan(index(SETUP));
    expect(index("Add the first component")).toBeLessThan(index("Format the app's own files once"));
    expect(index("Format the app's own files once")).toBeLessThan(index("Commit the result"));
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "Adopt the harness");
    expect(initHarness(repo.root, { force: false, starter: false }).report).not.toContain(SETUP);
  });
});
